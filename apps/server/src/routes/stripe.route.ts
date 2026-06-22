import { db } from "@yoyaku/db";
import { stripeWebhookEvents } from "@yoyaku/db/schema";
import type { EventMetadata } from "@yoyaku/event-store";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import Stripe from "stripe";
import type { ReservationStub } from "../durable-objects/_shared/rpc";
import { createStripe, createStripeV2 } from "../infrastructure/stripe/client";
import { syncConnectAccount } from "../lib/connect";
import type { AppEnv, Bindings } from "../types";

const reservationStub = (env: Bindings, id: string): ReservationStub =>
  env.RESERVATION.getByName(id) as unknown as ReservationStub;

const webhookMeta = (eventId: string): EventMetadata => ({
  correlationId: eventId,
  causationId: eventId,
  actor: "stripe-webhook",
});

type SnapshotEvent = Stripe.Event;
type ThinEvent = Stripe.V2.Core.EventNotification;
type WebhookEvent = SnapshotEvent | ThinEvent;

/**
 * Stripe webhook（認証不要・署名検証のみ・§5）。
 * - snapshot: v1 PaymentIntent events。`constructEventAsync` で検証。
 * - thin: Accounts v2 events。`parseEventNotificationAsync` で検証。
 *
 * Stripe Event Destination は payload style ごとに signing secret が分かれるため、
 * endpoint も分離して設定ミスを早く検知する。
 */
export const stripeRoute = new Hono<AppEnv>()
  .post("/webhook", (c) =>
    c.json(
      {
        error: "deprecated_webhook_endpoint",
        message: "Use /api/stripe/webhook/snapshot or /api/stripe/webhook/thin",
      },
      410,
    ),
  )
  .post("/webhook/snapshot", async (c) => {
    const sig = c.req.header("stripe-signature");
    if (!sig) return c.json({ error: "missing_signature" }, 400);
    const body = await c.req.text();
    const stripe = createStripe(c.env.STRIPE_SECRET_KEY);

    let event: SnapshotEvent;
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        sig,
        c.env.STRIPE_WEBHOOK_SNAPSHOT_SECRET,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch {
      return c.json({ error: "invalid_signature" }, 400);
    }

    return processEvent(c.env, stripe, event, handleSnapshotEvent);
  })
  .post("/webhook/thin", async (c) => {
    const sig = c.req.header("stripe-signature");
    if (!sig) return c.json({ error: "missing_signature" }, 400);
    const body = await c.req.text();
    // thin（Accounts v2 / Connect）は v2 preview API を叩くため preview 版クライアントを使う。
    // 署名検証（parseEventNotificationAsync）は API 版非依存なので影響なし。
    const stripe = createStripeV2(c.env.STRIPE_SECRET_KEY);

    let event: ThinEvent;
    try {
      event = await stripe.parseEventNotificationAsync(
        body,
        sig,
        c.env.STRIPE_WEBHOOK_THIN_SECRET,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch {
      return c.json({ error: "invalid_signature" }, 400);
    }

    return processEvent(c.env, stripe, event, handleThinEvent);
  });

async function processEvent<TEvent extends WebhookEvent>(
  env: Bindings,
  stripe: Stripe,
  event: TEvent,
  handle: (env: Bindings, stripe: Stripe, event: TEvent) => Promise<boolean>,
): Promise<Response> {
  // 冪等: 完了済み（processed/skipped）は再処理しない。未完（received/failed）は再処理可。
  if (!(await claimEvent(event))) return new Response(null, { status: 200 });

  try {
    const handled = await handle(env, stripe, event);
    await finishEvent(event.id, handled ? "processed" : "skipped");
  } catch (e) {
    await failEvent(event.id, e);
    return Response.json({ error: "processing_failed" }, { status: 500 }); // Stripe が再送
  }
  return new Response(null, { status: 200 });
}

/** event を処理対象として確保（新規 or 未完なら true）。完了済みは false。 */
async function claimEvent(event: WebhookEvent): Promise<boolean> {
  const existing = await db
    .select({ status: stripeWebhookEvents.status })
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.id, event.id))
    .get();
  if (existing) {
    return existing.status === "received" || existing.status === "failed";
  }
  const ids = extractIds(event);
  await db
    .insert(stripeWebhookEvents)
    .values({
      id: event.id,
      type: event.type,
      reservationId: ids.reservationId,
      paymentIntentId: ids.paymentIntentId,
      status: "received",
    })
    .onConflictDoNothing({ target: stripeWebhookEvents.id });
  return true;
}

async function finishEvent(
  id: string,
  status: "processed" | "skipped",
): Promise<void> {
  await db
    .update(stripeWebhookEvents)
    .set({ status, processedAt: new Date() })
    .where(eq(stripeWebhookEvents.id, id));
}

async function failEvent(id: string, error: unknown): Promise<void> {
  const row = await db
    .select({ attempts: stripeWebhookEvents.attempts })
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.id, id))
    .get();
  await db
    .update(stripeWebhookEvents)
    .set({
      status: "failed",
      attempts: (row?.attempts ?? 0) + 1,
      lastError: error instanceof Error ? error.message : String(error),
    })
    .where(eq(stripeWebhookEvents.id, id));
}

function extractIds(event: WebhookEvent): {
  reservationId: string | null;
  paymentIntentId: string | null;
} {
  if (!("data" in event)) {
    return { reservationId: null, paymentIntentId: null };
  }

  const obj = event.data.object as {
    id?: string;
    object?: string;
    metadata?: Record<string, string> | null;
  };
  const reservationId = obj.metadata?.reservationId ?? null;
  const paymentIntentId =
    obj.object === "payment_intent" ? (obj.id ?? null) : null;
  return { reservationId, paymentIntentId };
}

/** snapshot event をハンドルし、状態反映したら true（しなければ skipped=false）。冪等。 */
async function handleSnapshotEvent(
  env: Bindings,
  _stripe: Stripe,
  event: SnapshotEvent,
): Promise<boolean> {
  const eventType: string = event.type;
  switch (eventType) {
    case "payment_intent.amount_capturable_updated": {
      // オーソリ確保 = ReservationAuthorized（正本・§3.3）
      const pi = event.data.object as Stripe.PaymentIntent;
      const reservationId = pi.metadata?.reservationId;
      if (!reservationId) return false;
      const res = await reservationStub(env, reservationId).authorize(
        {
          paymentIntentId: pi.id,
          amount: pi.amount,
          applicationFeeAmount: pi.application_fee_amount ?? 0,
        },
        webhookMeta(event.id),
      );
      // 既 authorized/confirmed は ok（冪等）。invalid_state 等は skip（照合は Phase 10）。
      return res.ok;
    }
    case "payment_intent.succeeded": {
      // キャプチャ成立 = ReservationConfirmed→BookSeats の保険（§4.1）。capture は DO 所有
      // （Stripe capture は冪等・既 succeeded なら確定のみ進む）。
      const pi = event.data.object as Stripe.PaymentIntent;
      const reservationId = pi.metadata?.reservationId;
      if (!reservationId) return false;
      const res = await reservationStub(env, reservationId).capture(
        webhookMeta(event.id),
      );
      return res.ok;
    }
    default:
      // canceled / payment_failed 等は記録のみ（hold 失効が席を解放・与信 void は補償で実施）。
      return false;
  }
}

/** thin event をハンドルし、状態反映したら true（しなければ skipped=false）。冪等。 */
async function handleThinEvent(
  _env: Bindings,
  stripe: Stripe,
  event: ThinEvent,
): Promise<boolean> {
  const eventType: string = event.type;
  switch (eventType) {
    case "v2.core.account.created":
    case "v2.core.account[configuration.recipient].updated":
    case "v2.core.account[configuration.recipient].capability_status_updated":
    case "v2.core.account[requirements].updated": {
      const accountId = accountIdFromThinEvent(event);
      if (!accountId) return false;
      const account = await retrieveV2ConnectAccount(stripe, accountId);
      return account ? syncConnectAccount(account) : false;
    }
    default:
      // canceled / payment_failed 等は記録のみ（hold 失効が席を解放・与信 void は補償で実施）。
      return false;
  }
}

function accountIdFromThinEvent(event: ThinEvent): string | null {
  return (
    (event as unknown as { related_object?: { id?: string } }).related_object
      ?.id ?? null
  );
}

async function retrieveV2ConnectAccount(
  stripe: Stripe,
  id: string,
): Promise<Stripe.V2.Core.Account | null> {
  try {
    return await stripe.v2.core.accounts.retrieve(id, {
      include: [
        "configuration.recipient",
        "defaults",
        "identity",
        "requirements",
      ],
    });
  } catch (e) {
    if ((e as { type?: string }).type === "StripeInvalidRequestError") {
      return null;
    }
    throw e;
  }
}
