import { db } from "@yoyaku/db";
import {
  reconciliationExceptions,
  reservations,
  seatAvailabilities,
} from "@yoyaku/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { ulid } from "ulid";
import type { ReservationStub } from "../durable-objects/_shared/rpc";
import { createStripe } from "../infrastructure/stripe/client";
import { structuredLog } from "../lib/observability";
import {
  classifyReconciliation,
  isAutoCorrectable,
  type PaymentIntentStatus,
  type ReconciliationFact,
  type ReconciliationKind,
  type ReservationFactStatus,
} from "../lib/reconciliation";
import type { Bindings } from "../types";

/** 照合の実行結果（cron/管理エンドポイントの集計）。 */
export type ReconciliationSummary = {
  scanned: number;
  detected: Record<ReconciliationKind, number>;
  /** 自動是正が成功して resolved にした件数。 */
  corrected: number;
  /** 既存 open を健全化により resolved にした件数。 */
  healed: number;
};

const EMPTY_DETECTED: Record<ReconciliationKind, number> = {
  paid_no_seat: 0,
  seat_no_paid: 0,
  dangling_auth: 0,
  amount_mismatch: 0,
};

const reservationStub = (env: Bindings, id: string): ReservationStub =>
  env.RESERVATION.getByName(id) as unknown as ReservationStub;

const reconMeta = (reservationId: string) => ({
  correlationId: reservationId,
  causationId: reservationId,
  actor: "reconciliation",
});

/**
 * 照合ジョブ（FR-27）。PaymentIntent 状態（正本）と read model（席/予約）の不一致を検出・是正する。
 * - 重複 open 抑止: `reconciliation_exceptions` の部分 UNIQUE `(reservation_id, kind) WHERE status='open'`。
 * - 自動是正: paid_no_seat → authorize+capture 冪等リトライ（FR-39）/ dangling_auth → PI void。
 * - 健全化: 事実が一致した予約に残る open 例外は resolved へ収束させる（冪等・再実行安全）。
 */
export async function runReconciliation(
  env: Bindings,
  opts: { limit?: number } = {},
): Promise<ReconciliationSummary> {
  const limit = opts.limit ?? 200;
  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const now = Date.now();

  const candidates = await db
    .select({
      reservationId: reservations.reservationId,
      status: reservations.status,
      showingId: reservations.showingId,
      paymentIntentId: reservations.paymentIntentId,
      seatIds: reservations.seatIds,
      totalAmount: reservations.totalAmount,
      currency: reservations.currency,
      holdExpiresAt: reservations.holdExpiresAt,
    })
    .from(reservations)
    .where(isNotNull(reservations.paymentIntentId))
    .limit(limit)
    .all();

  const summary: ReconciliationSummary = {
    scanned: candidates.length,
    detected: { ...EMPTY_DETECTED },
    corrected: 0,
    healed: 0,
  };

  for (const r of candidates) {
    if (!r.paymentIntentId) continue;
    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.retrieve(r.paymentIntentId);
    } catch (e) {
      console.log(
        structuredLog("warn", "reconciliation_pi_fetch_failed", {
          reservationId: r.reservationId,
          paymentIntentId: r.paymentIntentId,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      continue;
    }

    const piStatus = pi.status as PaymentIntentStatus;
    const seatsBooked = await areSeatsBooked(
      r.showingId,
      r.reservationId,
      r.seatIds.length,
    );
    const fact: ReconciliationFact = {
      reservationStatus: r.status as ReservationFactStatus,
      paymentIntentStatus: piStatus,
      seatsBooked,
      expectedAmount: r.totalAmount,
      capturedAmount: piStatus === "succeeded" ? pi.amount_received : null,
      holdExpired: r.holdExpiresAt != null && now > r.holdExpiresAt.getTime(),
    };

    const kind = classifyReconciliation(fact);
    if (kind === null) {
      // 事実が一致 → 残っている open 例外を resolved に収束（冪等）。
      summary.healed += await resolveOpen(r.reservationId);
      continue;
    }

    summary.detected[kind] += 1;
    await recordException(r.reservationId, r.paymentIntentId, kind, fact, pi);

    if (!isAutoCorrectable(kind)) continue;
    const corrected =
      kind === "paid_no_seat"
        ? await correctPaidNoSeat(env, r.reservationId, pi)
        : await correctDanglingAuth(stripe, r.reservationId, pi);
    if (corrected) {
      await resolveOne(r.reservationId, kind);
      summary.corrected += 1;
    }
  }

  return summary;
}

/** 当該予約の席がすべて booked 反映済みか（read model）。0 席は false。 */
async function areSeatsBooked(
  showingId: string,
  reservationId: string,
  seatCount: number,
): Promise<boolean> {
  if (seatCount === 0) return false;
  const row = await db
    .select({ c: sql<number>`count(*)` })
    .from(seatAvailabilities)
    .where(
      and(
        eq(seatAvailabilities.showingId, showingId),
        eq(seatAvailabilities.bookedByReservationId, reservationId),
      ),
    )
    .get();
  return (row?.c ?? 0) >= seatCount;
}

/** OPEN 例外を 1 件確保（部分 UNIQUE が重複 open を抑止＝既存なら no-op）。 */
async function recordException(
  reservationId: string,
  paymentIntentId: string,
  kind: ReconciliationKind,
  fact: ReconciliationFact,
  pi: Stripe.PaymentIntent,
): Promise<void> {
  await db
    .insert(reconciliationExceptions)
    .values({
      id: ulid(),
      reservationId,
      paymentIntentId,
      kind,
      expectedAmount: fact.expectedAmount,
      actualAmount: fact.capturedAmount,
      currency: pi.currency.toUpperCase(),
      detail: {
        reservationStatus: fact.reservationStatus,
        paymentIntentStatus: fact.paymentIntentStatus,
        seatsBooked: fact.seatsBooked,
        holdExpired: fact.holdExpired,
      },
      status: "open",
    })
    .onConflictDoNothing();
}

/** paid_no_seat 是正: authorize+capture を冪等リトライし captured⇒booked を確定（FR-39）。 */
async function correctPaidNoSeat(
  env: Bindings,
  reservationId: string,
  pi: Stripe.PaymentIntent,
): Promise<boolean> {
  const stub = reservationStub(env, reservationId);
  const meta = reconMeta(reservationId);
  // authorize は既 Authorized/Confirmed で冪等 ok。capture は DO 所有（BeginCapture→Stripe capture
  // 冪等駆動→Confirmed→BookSeats）。PI は既に succeeded のため capture は確定のみ進む。
  await stub.authorize(
    {
      paymentIntentId: pi.id,
      amount: pi.amount,
      applicationFeeAmount: pi.application_fee_amount ?? 0,
    },
    meta,
  );
  const cap = await stub.capture(meta);
  return cap.ok;
}

/** dangling_auth 是正: requires_capture の PI を void（既に確定/取消済みは冪等に成功扱い）。 */
async function correctDanglingAuth(
  stripe: Stripe,
  reservationId: string,
  pi: Stripe.PaymentIntent,
): Promise<boolean> {
  try {
    await stripe.paymentIntents.cancel(pi.id, undefined, {
      idempotencyKey: `${reservationId}:recon-void`,
    });
    return true;
  } catch (e) {
    // PI が cancelable でない（既に succeeded/canceled）＝ dangling は解消済み → 是正成功扱い。
    if ((e as { type?: string }).type === "StripeInvalidRequestError") {
      return true;
    }
    console.log(
      structuredLog("warn", "reconciliation_void_failed", {
        reservationId,
        paymentIntentId: pi.id,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return false;
  }
}

/** (reservationId, kind) の open を resolved に。 */
async function resolveOne(
  reservationId: string,
  kind: ReconciliationKind,
): Promise<void> {
  await db
    .update(reconciliationExceptions)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(
      and(
        eq(reconciliationExceptions.reservationId, reservationId),
        eq(reconciliationExceptions.kind, kind),
        eq(reconciliationExceptions.status, "open"),
      ),
    );
}

/** 予約に残る open 例外を一括 resolved（健全化）。resolved にした件数を返す。 */
async function resolveOpen(reservationId: string): Promise<number> {
  const open = await db
    .select({ id: reconciliationExceptions.id })
    .from(reconciliationExceptions)
    .where(
      and(
        eq(reconciliationExceptions.reservationId, reservationId),
        eq(reconciliationExceptions.status, "open"),
      ),
    )
    .all();
  if (open.length === 0) return 0;
  await db
    .update(reconciliationExceptions)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(
      and(
        eq(reconciliationExceptions.reservationId, reservationId),
        eq(reconciliationExceptions.status, "open"),
      ),
    );
  return open.length;
}
