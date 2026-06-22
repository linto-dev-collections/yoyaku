import { db } from "@yoyaku/db";
import { aggregateRegistry } from "@yoyaku/db/schema";
import { isAggregateCreateEvent, subscribesToAnyStream } from "./predicates";
import type { Projection, ProjectionStmt } from "./types";

/**
 * aggregate_registry 投影（追記専用・cold rebuild 基盤・§4.5）。作成イベント
 * （ShowingRegistered / ReservationInitiated）の到達時に集約 ID を 1 行登録する。
 *
 * - **insert-or-ignore で冪等**: 再配信・再投影・backfill で何度処理しても重複登録しない。
 * - **RESETTABLE に含めない**（reprojection-plan.ts）: reproject で truncate されず、
 *   read model 全損後も全集約 ID を保持する。reproject はこの ID 集合から再生対象を列挙する。
 * - 後追い projection（新規 read model をゼロから過去再生で構築）の ID 列挙源にもなる。
 */
export const aggregateRegistryProjection: Projection = {
  name: "aggregate_registry",
  subscribesTo: subscribesToAnyStream,
  apply: (msg): ProjectionStmt[] => {
    if (!isAggregateCreateEvent(msg.aggregateType, msg.eventType)) return [];
    return [
      db
        .insert(aggregateRegistry)
        .values({
          aggregateType: msg.aggregateType,
          aggregateId: msg.aggregateId,
        })
        .onConflictDoNothing(),
    ];
  },
};
