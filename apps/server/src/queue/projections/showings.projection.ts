import { db } from "@yoyaku/db";
import { showings } from "@yoyaku/db/schema";
import type { ShowingEvent } from "@yoyaku/domain";
import { and, eq, lt } from "drizzle-orm";
import { subscribesToShowing } from "./predicates";
import type { Projection, ProjectionStmt } from "./types";

/** showings 読みモデル投影（ヘッダ＋ライフサイクル状態）。 */
export const showingsProjection: Projection = {
  name: "showings",
  subscribesTo: subscribesToShowing,
  apply: (msg): ProjectionStmt[] => {
    const e = msg.payload as ShowingEvent;
    const showingId = msg.aggregateId;
    switch (e.type) {
      case "ShowingRegistered": {
        const riskTier = e.riskTier ?? "general";
        const maxSeatsPerUser = e.maxSeatsPerUser ?? 4;
        return [
          db
            .insert(showings)
            .values({
              showingId,
              organizationId: e.organizationId,
              title: e.title,
              venue: e.venue ?? null,
              startsAt: new Date(e.startsAt),
              salesStartAt:
                e.salesStartAt != null ? new Date(e.salesStartAt) : null,
              salesEndAt: e.salesEndAt != null ? new Date(e.salesEndAt) : null,
              status: "draft",
              currency: e.currency,
              totalSeats: e.totalSeats,
              riskTier,
              maxSeatsPerUser,
              lastSeq: msg.seq,
            })
            .onConflictDoUpdate({
              target: showings.showingId,
              set: {
                organizationId: e.organizationId,
                title: e.title,
                venue: e.venue ?? null,
                startsAt: new Date(e.startsAt),
                salesStartAt:
                  e.salesStartAt != null ? new Date(e.salesStartAt) : null,
                salesEndAt:
                  e.salesEndAt != null ? new Date(e.salesEndAt) : null,
                status: "draft",
                currency: e.currency,
                totalSeats: e.totalSeats,
                riskTier,
                maxSeatsPerUser,
                lastSeq: msg.seq,
              },
              // 行ごと CAS: 既により新しい seq を見ていれば上書きしない（重複再配信で status を draft に戻さない）。
              setWhere: lt(showings.lastSeq, msg.seq),
            }),
        ];
      }
      case "ShowingPublished":
        return [statusUpdate(showingId, "on_sale", msg.seq)];
      case "ShowingUnpublished":
        return [statusUpdate(showingId, "draft", msg.seq)];
      case "ShowingClosed":
        return [statusUpdate(showingId, "closed", msg.seq)];
      case "ShowingSoldOut":
        return [statusUpdate(showingId, "sold_out", msg.seq)];
      default:
        // SeatsImported/SeatsHeld 等は購読のみ（position 前進）で read model 変更なし。
        return [];
    }
  },
};

function statusUpdate(
  showingId: string,
  status: "draft" | "on_sale" | "closed" | "sold_out",
  seq: number,
): ProjectionStmt {
  return db
    .update(showings)
    .set({ status, lastSeq: seq })
    .where(
      and(
        eq(showings.showingId, showingId),
        // 行ごと CAS（順序非依存化）: この行が既に >= seq を適用済みなら no-op。
        lt(showings.lastSeq, seq),
      ),
    );
}
