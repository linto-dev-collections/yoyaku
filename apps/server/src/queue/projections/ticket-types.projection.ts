import { db } from "@yoyaku/db";
import { ticketTypes } from "@yoyaku/db/schema";
import type { ShowingEvent } from "@yoyaku/domain";
import { lt } from "drizzle-orm";
import { subscribesToShowing } from "./predicates";
import type { Projection, ProjectionStmt } from "./types";

/** ticket_types 読みモデル投影（席種は公演ヘッダ＝ShowingRegistered に内包）。 */
export const ticketTypesProjection: Projection = {
  name: "ticket_types",
  subscribesTo: subscribesToShowing,
  apply: (msg): ProjectionStmt[] => {
    const e = msg.payload as ShowingEvent;
    if (e.type !== "ShowingRegistered") return [];
    const showingId = msg.aggregateId;
    return e.ticketTypes.map((t) =>
      db
        .insert(ticketTypes)
        .values({
          showingId,
          ticketTypeId: t.ticketTypeId,
          name: t.name,
          unitAmount: t.unitAmount,
          currency: t.currency,
          lastSeq: msg.seq,
        })
        .onConflictDoUpdate({
          target: [ticketTypes.showingId, ticketTypes.ticketTypeId],
          set: {
            name: t.name,
            unitAmount: t.unitAmount,
            currency: t.currency,
            lastSeq: msg.seq,
          },
          // 行ごと CAS: 既により新しい seq を見ていれば上書きしない（重複再配信に対する冪等化）。
          setWhere: lt(ticketTypes.lastSeq, msg.seq),
        }),
    );
  },
};
