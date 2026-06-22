import { db } from "@yoyaku/db";
import { reservations } from "@yoyaku/db/schema";
import type { ReservationEvent } from "@yoyaku/domain";
import { and, eq, lt } from "drizzle-orm";
import { subscribesToReservation } from "./predicates";
import type { Projection, ProjectionStmt } from "./types";

type ApiStatus =
  | "initiated"
  | "awaiting_payment"
  | "authorized"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "payment_failed"
  | "failed";

/** reservations 読みモデル投影（購入プロセスの状態＋価格固定一式）。マイチケットは WHERE で表現。 */
export const reservationsProjection: Projection = {
  name: "reservations",
  subscribesTo: subscribesToReservation,
  apply: (msg): ProjectionStmt[] => {
    const e = msg.payload as ReservationEvent;
    const reservationId = msg.aggregateId;
    switch (e.type) {
      case "ReservationInitiated": {
        const values = {
          reservationId,
          userId: e.userId,
          showingId: e.showingId,
          organizationId: e.organizationId,
          status: "initiated" as const,
          seatIds: e.seatIds,
          quantity: e.pricing.quantity,
          subtotalAmount: e.pricing.subtotalAmount,
          applicationFeeAmount: e.pricing.applicationFeeAmount,
          totalAmount: e.pricing.totalAmount,
          currency: e.pricing.currency,
          lastSeq: msg.seq,
        };
        return [
          db
            .insert(reservations)
            .values(values)
            .onConflictDoUpdate({
              target: reservations.reservationId,
              set: values,
              // 行ごと CAS: 既により新しい seq を見ていれば上書きしない（重複再配信で初期状態に戻さない）。
              setWhere: lt(reservations.lastSeq, msg.seq),
            }),
        ];
      }
      case "ReservationHeld":
        return [
          statusUpdate(reservationId, "awaiting_payment", msg.seq, {
            holdExpiresAt: new Date(e.holdExpiresAt),
          }),
        ];
      case "ReservationPaymentPending":
        // status は変えず paymentIntentId だけ反映（照合が早期に拾える・FR-26/FR-27）。
        return [
          db
            .update(reservations)
            .set({ paymentIntentId: e.paymentIntentId, lastSeq: msg.seq })
            .where(
              and(
                eq(reservations.reservationId, reservationId),
                lt(reservations.lastSeq, msg.seq),
              ),
            ),
        ];
      case "ReservationAuthorized":
        return [
          statusUpdate(reservationId, "authorized", msg.seq, {
            paymentIntentId: e.paymentIntentId,
            authorizedAt: new Date(msg.occurredAt),
          }),
        ];
      case "ReservationConfirmed":
        return [
          statusUpdate(reservationId, "confirmed", msg.seq, {
            confirmedAt: new Date(e.confirmedAt),
          }),
        ];
      case "ReservationExpired":
        return [statusUpdate(reservationId, "expired", msg.seq)];
      case "ReservationPaymentFailed":
        return [statusUpdate(reservationId, "payment_failed", msg.seq)];
      case "ReservationCancelled":
        return [statusUpdate(reservationId, "cancelled", msg.seq)];
      case "ReservationFailed":
        return [statusUpdate(reservationId, "failed", msg.seq)];
      default:
        return [];
    }
  },
};

function statusUpdate(
  reservationId: string,
  status: ApiStatus,
  seq: number,
  extra: {
    holdExpiresAt?: Date;
    authorizedAt?: Date;
    confirmedAt?: Date;
    paymentIntentId?: string;
  } = {},
): ProjectionStmt {
  return db
    .update(reservations)
    .set({ status, lastSeq: seq, ...extra })
    .where(
      and(
        eq(reservations.reservationId, reservationId),
        // 行ごと CAS（順序非依存化）: この行が既に >= seq を適用済みなら no-op。
        lt(reservations.lastSeq, seq),
      ),
    );
}
