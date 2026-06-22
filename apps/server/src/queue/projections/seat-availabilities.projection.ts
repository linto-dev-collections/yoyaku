import { db } from "@yoyaku/db";
import { seatAvailabilities } from "@yoyaku/db/schema";
import type { ShowingEvent } from "@yoyaku/domain";
import { and, eq, lt } from "drizzle-orm";
import { subscribesToShowing } from "./predicates";
import type { Projection, ProjectionStmt } from "./types";

/** seat_availabilities 読みモデル投影（静的属性＋動的状態を 1 行に同居・UC-02 単一走査）。 */
export const seatAvailabilitiesProjection: Projection = {
  name: "seat_availabilities",
  subscribesTo: subscribesToShowing,
  apply: (msg): ProjectionStmt[] => {
    const e = msg.payload as ShowingEvent;
    const showingId = msg.aggregateId;
    switch (e.type) {
      case "SeatsImported":
        return e.seats.map((s) =>
          db
            .insert(seatAvailabilities)
            .values({
              showingId,
              seatId: s.seatId,
              section: e.section,
              rowLabel: s.rowLabel ?? null,
              seatNumber: s.seatNumber ?? null,
              ticketTypeId: s.ticketTypeId,
              status: "available",
              lastSeq: msg.seq,
            })
            .onConflictDoUpdate({
              target: [seatAvailabilities.showingId, seatAvailabilities.seatId],
              set: {
                section: e.section,
                rowLabel: s.rowLabel ?? null,
                seatNumber: s.seatNumber ?? null,
                ticketTypeId: s.ticketTypeId,
                status: "available",
                lastSeq: msg.seq,
              },
              // 行ごと CAS: 既により新しい seq を見ていれば上書きしない（reorder/重複再適用で巻き戻さない）。
              setWhere: lt(seatAvailabilities.lastSeq, msg.seq),
            }),
        );
      case "SeatsHeld":
        return e.seatIds.map((seatId) =>
          seatUpdate(showingId, seatId, msg.seq, {
            status: "held",
            heldByReservationId: e.reservationId,
            bookedByReservationId: null,
            holdExpiresAt: new Date(e.holdExpiresAt),
          }),
        );
      case "SeatsBooked":
        return e.seatIds.map((seatId) =>
          seatUpdate(showingId, seatId, msg.seq, {
            status: "booked",
            bookedByReservationId: e.reservationId,
            heldByReservationId: null,
            holdExpiresAt: null,
          }),
        );
      case "SeatsReleased":
        return e.seatIds.map((seatId) =>
          seatUpdate(showingId, seatId, msg.seq, {
            status: "available",
            heldByReservationId: null,
            bookedByReservationId: null,
            holdExpiresAt: null,
          }),
        );
      default:
        return [];
    }
  },
};

function seatUpdate(
  showingId: string,
  seatId: string,
  seq: number,
  set: {
    status: "available" | "held" | "booked";
    heldByReservationId?: string | null;
    bookedByReservationId?: string | null;
    holdExpiresAt?: Date | null;
  },
): ProjectionStmt {
  return db
    .update(seatAvailabilities)
    .set({ ...set, lastSeq: seq })
    .where(
      and(
        eq(seatAvailabilities.showingId, showingId),
        eq(seatAvailabilities.seatId, seatId),
        // 行ごと CAS（順序非依存化）: この行が既に >= seq を適用済みなら no-op。
        lt(seatAvailabilities.lastSeq, seq),
      ),
    );
}
