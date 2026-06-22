import { db } from "@yoyaku/db";
import {
  projectionDeadLetters,
  reconciliationExceptions,
  reservations,
  stripeWebhookEvents,
} from "@yoyaku/db/schema";
import { eq, sql } from "drizzle-orm";
import { type ConversionStats, conversionStats } from "../lib/conversion";
import { type MetricsSnapshot, tally } from "../lib/observability";

/**
 * 運用メトリクスの収集（NFR-09）。read model / 運用テーブルの GROUP BY 集計を
 * 純粋な `tally`/`alertsFor`（observability.ts）に渡せる形で返す。重い指標（反映ラグ等）は
 * Cloudflare Workers Logs/Analytics で補完する（§13）。
 */
export async function gatherMetrics(): Promise<MetricsSnapshot> {
  const [resRows, exRows, whRows, dlRows] = await Promise.all([
    db
      .select({ key: reservations.status, count: sql<number>`count(*)` })
      .from(reservations)
      .groupBy(reservations.status)
      .all(),
    db
      .select({
        key: reconciliationExceptions.kind,
        count: sql<number>`count(*)`,
      })
      .from(reconciliationExceptions)
      .where(eq(reconciliationExceptions.status, "open"))
      .groupBy(reconciliationExceptions.kind)
      .all(),
    db
      .select({ key: stripeWebhookEvents.status, count: sql<number>`count(*)` })
      .from(stripeWebhookEvents)
      .groupBy(stripeWebhookEvents.status)
      .all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(projectionDeadLetters)
      .where(eq(projectionDeadLetters.status, "open"))
      .all(),
  ]);
  return {
    reservationsByStatus: tally(resRows),
    openExceptionsByKind: tally(exRows),
    webhookEventsByStatus: tally(whRows),
    openDeadLetters: dlRows[0]?.count ?? 0,
  };
}

/** 公演単位のコンバージョン/離脱（FR-24）。reservations の status 件数から純粋計算。 */
export async function gatherConversion(
  showingId: string,
): Promise<ConversionStats> {
  const rows = await db
    .select({ key: reservations.status, count: sql<number>`count(*)` })
    .from(reservations)
    .where(eq(reservations.showingId, showingId))
    .groupBy(reservations.status)
    .all();
  return conversionStats(tally(rows));
}
