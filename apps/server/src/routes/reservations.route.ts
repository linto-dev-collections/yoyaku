import { zValidator } from "@hono/zod-validator";
import { db } from "@yoyaku/db";
import { showings } from "@yoyaku/db/schema";
import { DomainError } from "@yoyaku/domain";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ReservationStub } from "../durable-objects/_shared/rpc";
import { createStripe } from "../infrastructure/stripe/client";
import { getConnectAccount } from "../lib/connect";
import { getOrCreateCustomer } from "../lib/customer";
import { allocateCanonicalId } from "../lib/intake";
import { computePricing } from "../lib/pricing";
import { verifyTurnstile } from "../lib/turnstile";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv, Bindings } from "../types";
import { startReservationSchema } from "./schemas";

const reservationStub = (env: Bindings, id: string): ReservationStub =>
  env.RESERVATION.getByName(id) as unknown as ReservationStub;

/**
 * 高リスク公演（riskTier=high_risk）でのみ Turnstile を必須化（FR-17・§4）。
 * トークンは `cf-turnstile-response` ヘッダで受け、siteverify 失敗は 403（フェイルクローズ）。
 * general/popular は no-op（一般は任意）。
 */
async function enforceTurnstile(
  c: Context<AppEnv>,
  riskTier: string | null | undefined,
): Promise<void> {
  if (riskTier !== "high_risk") return;
  const token = c.req.header("cf-turnstile-response");
  const ok = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    token,
    c.req.header("cf-connecting-ip"),
  );
  if (!ok) {
    throw new DomainError(
      "turnstile_required",
      403,
      "混雑対策の確認（Turnstile）に失敗しました。再度お試しください。",
    );
  }
}

/**
 * 予約（購入者）。確保→オーソリ→キャプチャの2段階 Saga の一歩目（§3）。
 * StartReservation は intake で正準 reservationId を払い出し、Reservation DO 経由で Showing DO に HoldSeats。
 * 同一席の同時確保は Showing DO の直列化で先着のみ成功＝後発は seat_conflict(409)。確定/取消/決済は Phase 05/06。
 */
export const reservationsRoute = new Hono<AppEnv>()
  .post(
    "/",
    requireAuth,
    rateLimit((e) => e.RATE_LIMIT_START, "start"),
    zValidator("json", startReservationSchema, (r, c) => {
      if (!r.success)
        return c.json(
          { error: "invalid_request", issues: r.error.issues },
          422,
        );
    }),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const { showingId, seatIds } = c.req.valid("json");

      // 公演ヘッダ（組織・通貨・区分）を read model から取得。販売状態の最終判定は Showing DO（HoldSeats）。
      const showing = await db
        .select({
          organizationId: showings.organizationId,
          currency: showings.currency,
          riskTier: showings.riskTier,
        })
        .from(showings)
        .where(eq(showings.showingId, showingId))
        .get();
      if (!showing) {
        throw new DomainError("not_found", 404, "showing not found");
      }
      // 高リスク公演は確保前に Turnstile を必須化（FR-17）。
      await enforceTurnstile(c, showing.riskTier);

      // 価格固定（FR-38）。席が read model に無ければ 422。
      const priced = await computePricing(showingId, seatIds, showing.currency);
      if (!priced.ok) {
        throw new DomainError(
          "invalid_seats",
          422,
          `unknown seats: ${priced.missingSeats.join(", ")}`,
        );
      }

      // intake で reservationId 払い出し（冪等・二段目は Reservation DO の状態機械）。
      const idemKey = c.req.header("Idempotency-Key") ?? crypto.randomUUID();
      const alloc = await allocateCanonicalId(
        c.env,
        idemKey,
        "StartReservation",
        { userId: user.id, showingId, seatIds },
      );
      if (!alloc.ok)
        throw new DomainError(alloc.code, alloc.httpStatus, alloc.message);
      const reservationId = alloc.canonicalId;

      const stub = reservationStub(c.env, reservationId);
      const meta = { correlationId: crypto.randomUUID(), actor: user.id };
      const result = await stub.start(
        {
          reservationId,
          userId: user.id,
          showingId,
          organizationId: showing.organizationId,
          seatIds,
          pricing: priced.pricing,
          requestedAt: Date.now(),
        },
        meta,
      );
      if (!result.ok) {
        throw new DomainError(result.code, result.httpStatus, result.message);
      }
      return c.json(
        { reservationId, holdExpiresAt: result.holdExpiresAt },
        201,
      );
    },
  )
  // オーソリ: manual capture の PaymentIntent を作成し client_secret を返す（confirm はクライアント・§3.1）。
  // 状態遷移（ReservationAuthorized）は webhook `amount_capturable_updated` を正本とする（指摘 4）。
  .post(
    "/:id/authorize",
    requireAuth,
    rateLimit((e) => e.RATE_LIMIT_AUTHORIZE, "authorize"),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const id = c.req.param("id");
      const view = await reservationStub(c.env, id).view();
      if (!view) return c.json({ error: "not_found" }, 404);
      if (view.userId !== user.id) return c.json({ error: "forbidden" }, 403);
      if (view.status !== "awaiting_payment" || !view.pricing) {
        throw new DomainError(
          "invalid_state",
          409,
          `cannot authorize in ${view.status}`,
        );
      }
      // 高リスク公演は決済前にも Turnstile を必須化（FR-17・§4）。
      if (view.showingId) {
        const row = await db
          .select({ riskTier: showings.riskTier })
          .from(showings)
          .where(eq(showings.showingId, view.showingId))
          .get();
        await enforceTurnstile(c, row?.riskTier);
      }
      // BR-10: 確保期限内のみ（期限切れは解放対象）。
      if (view.holdExpiresAt != null && Date.now() > view.holdExpiresAt) {
        throw new DomainError(
          "hold_expired",
          409,
          "reservation hold has expired",
        );
      }
      const connect = view.organizationId
        ? await getConnectAccount(view.organizationId)
        : null;
      if (!connect?.chargesEnabled) {
        throw new DomainError(
          "connect_not_ready",
          409,
          "organizer cannot accept payments yet",
        );
      }

      const stripe = createStripe(c.env.STRIPE_SECRET_KEY);
      const customerId = await getOrCreateCustomer(stripe, {
        id: user.id,
        email: user.email,
        name: user.name,
      });
      const pi = await stripe.paymentIntents.create(
        {
          amount: view.pricing.totalAmount,
          currency: view.pricing.currency.toLowerCase(),
          capture_method: "manual",
          customer: customerId,
          automatic_payment_methods: { enabled: true },
          application_fee_amount: view.pricing.applicationFeeAmount,
          transfer_data: { destination: connect.stripeConnectAccountId },
          metadata: { reservationId: id, showingId: view.showingId ?? "" },
        },
        { idempotencyKey: `${id}:authorize` },
      );
      // PI 作成直後に reservationId へ記録（確保失効が webhook より先でも与信 void できる・FR-26/BR-11）。
      // webhook(amount_capturable_updated) を待たずに state.paymentIntentId を確定させる。
      const attach = await reservationStub(c.env, id).attachPaymentIntent(
        { paymentIntentId: pi.id },
        { correlationId: crypto.randomUUID(), actor: user.id },
      );
      if (!attach.ok) {
        throw new DomainError(attach.code, attach.httpStatus, attach.message);
      }
      return c.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
    },
  )
  // キャプチャ: 本人検証後、DO 所有の capture を起動（§4・指摘: capture×失効競合）。
  // Stripe capture は DO 内で冪等駆動し、着手時に Capturing（非失効）へ遷移するため、外部 I/O 中の
  // hold 失効で席が解放されない。状態妥当性（authorized/capturing/confirmed か）は DO が判定。
  .post(
    "/:id/capture",
    requireAuth,
    rateLimit((e) => e.RATE_LIMIT_CAPTURE, "capture"),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const id = c.req.param("id");
      const stub = reservationStub(c.env, id);
      const view = await stub.view();
      if (!view) return c.json({ error: "not_found" }, 404);
      if (view.userId !== user.id) return c.json({ error: "forbidden" }, 403);

      const meta = { correlationId: crypto.randomUUID(), actor: user.id };
      const result = await stub.capture(meta);
      if (!result.ok) {
        throw new DomainError(result.code, result.httpStatus, result.message);
      }
      return c.json({ reservationId: id, status: "confirmed" });
    },
  )
  // 取消（確保中のみ・確定後 409・本人検証は DO 側）。冪等で 204。
  .delete("/:id", requireAuth, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const stub = reservationStub(c.env, c.req.param("id"));
    const meta = { correlationId: crypto.randomUUID(), actor: user.id };
    const result = await stub.cancel({ requestedBy: user.id }, meta);
    if (!result.ok) {
      throw new DomainError(result.code, result.httpStatus, result.message);
    }
    return c.body(null, 204);
  })
  // 予約照会（read-your-writes＝DO から直読・投影ラグ回避・FR-21）。本人のみ。
  .get("/:id", requireAuth, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const stub = reservationStub(c.env, c.req.param("id"));
    const view = await stub.view();
    if (!view) return c.json({ error: "not_found" }, 404);
    if (view.userId !== user.id) return c.json({ error: "forbidden" }, 403);
    return c.json(view);
  });
