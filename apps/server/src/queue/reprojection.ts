import { db } from "@yoyaku/db";
import {
  positions,
  reservations,
  salesDashboards,
  seatAvailabilities,
  showings,
  ticketTypes,
} from "@yoyaku/db/schema";
import { eq } from "drizzle-orm";

import type { ResettableProjection } from "./reprojection-plan";

export type { ResettableProjection } from "./reprojection-plan";

/**
 * 対象 read model を truncate し、positions の該当 projection 行を削除（lastSeq=0 相当）。
 * その後の再生（DO の events を seq 昇順で PROJECTION_QUEUE へ再投入 or 直接 apply）は
 * Phase 10 の管理エンドポイント/cron で行う（本フェーズはリセットまで）。これが**後追い projection の土台**
 * （新規 read model を 0 から過去イベント再生で構築する・§5）。
 *
 * 注: `showings` の truncate は FK onDelete cascade で ticket_types / seat_availabilities の
 * 行も消える。完全な再構築では 3 投影の positions すべてをリセットする（Phase 10 runbook）。
 * `sales_dashboards` は 2 ストリーム集約のため positions に `(sales_dashboards, showingId)` と
 * `(sales_dashboards, reservationId)` が混在するが、projection 名での一括削除で両ソースとも 0 に戻る。
 */
export async function resetProjection(
  projectionName: ResettableProjection,
): Promise<void> {
  const positionsReset = db
    .delete(positions)
    .where(eq(positions.projection, projectionName));
  switch (projectionName) {
    case "showings":
      await db.batch([db.delete(showings), positionsReset]);
      return;
    case "ticket_types":
      await db.batch([db.delete(ticketTypes), positionsReset]);
      return;
    case "seat_availabilities":
      await db.batch([db.delete(seatAvailabilities), positionsReset]);
      return;
    case "sales_dashboards":
      await db.batch([db.delete(salesDashboards), positionsReset]);
      return;
    case "reservations":
      // Reservation ストリーム単独・FK cascade 無し＝独立に truncate＋positions リセット（指摘5a）。
      await db.batch([db.delete(reservations), positionsReset]);
      return;
    default:
      projectionName satisfies never;
  }
}
