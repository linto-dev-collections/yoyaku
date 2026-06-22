import { db } from "@yoyaku/db";
import {
  reservations,
  salesDashboards,
  seatAvailabilities,
} from "@yoyaku/db/schema";
import type { ReservationEvent, ShowingEvent } from "@yoyaku/domain";
import { eq, sql } from "drizzle-orm";
import { subscribesToSales } from "./predicates";
import type { Projection, ProjectionStmt } from "./types";

type ShowingRegistered = Extract<ShowingEvent, { type: "ShowingRegistered" }>;

/**
 * sales_dashboards 投影（Showing + Reservation の 2 ストリーム集約・§1）。`showingId` PK の 1 行へ
 * 在庫カウント（Showing 由来）と売上/件数（Reservation 由来）を集約する。
 *
 * **絶対値導出で自己修復（冪等）**: 旧実装の `+=` 増分をやめ、各フィールドを source read model から
 * 都度「絶対値」で再計算する。何度適用しても同じ結果になるため、Queue の重複配信・並行 invocation・
 * position 後退・再投影のいずれでもカウントがズレず自己修復する（増分は position に依存し自己修復しない）。
 * 投影適用順（projections/index.ts）で seat_availabilities / reservations が先に更新済みのため、
 * 同一メッセージ処理内で最新の source を集計できる。
 */
export const salesDashboardsProjection: Projection = {
  name: "sales_dashboards",
  subscribesTo: subscribesToSales,
  apply: (msg): ProjectionStmt[] => {
    if (msg.aggregateType === "Showing") {
      const e = msg.payload as ShowingEvent;
      if (e.type === "ShowingRegistered")
        // 行作成に加え、Reservation 統計も**この時点で**絶対再計算する。Reservation イベントが
        // ShowingRegistered より先に処理された場合（順序保証なし・特に再投影）、その時の UPDATE は
        // 行未作成で取りこぼされる。ここで再計算すれば「後から来た側」が必ず拾い直す（同一 batch・順序実行で
        // registerRow の行作成後に走る）。絶対値導出なので冪等。
        return [
          registerRow(msg.aggregateId, e),
          recomputeReservationStatsByShowing(msg.aggregateId),
        ];
      // 在庫カウント（available/held/booked）は seat_availabilities から絶対再計算。
      if (
        e.type === "SeatsImported" ||
        e.type === "SeatsHeld" ||
        e.type === "SeatsBooked" ||
        e.type === "SeatsReleased"
      ) {
        return [recomputeSeatCounts(msg.aggregateId)];
      }
      return [];
    }
    // Reservation ストリーム（売上・hold/booked 件数）。reservations から絶対再計算。
    const e = msg.payload as ReservationEvent;
    if (e.type === "ReservationConfirmed") {
      // showingId は payload に含まれる（自己完結・§1）。
      return [recomputeReservationStatsByShowing(e.showingId)];
    }
    if (e.type === "ReservationHeld") {
      // ReservationHeld は payload に showingId を持たないため、当該予約の showingId 経由で対象行を特定
      // （reservations 投影が先に処理済みのため reservations 行は最新）。
      return [recomputeReservationStatsByReservation(msg.aggregateId)];
    }
    return [];
  },
};

/** ShowingRegistered: 行を作成し総席数/帰属/通貨を確定（カウント/売上は別イベントで絶対再計算）。 */
function registerRow(showingId: string, e: ShowingRegistered): ProjectionStmt {
  return db
    .insert(salesDashboards)
    .values({
      showingId,
      organizationId: e.organizationId,
      totalSeats: e.totalSeats,
      currency: e.currency,
    })
    .onConflictDoUpdate({
      target: salesDashboards.showingId,
      set: {
        organizationId: e.organizationId,
        totalSeats: e.totalSeats,
        currency: e.currency,
      },
    });
}

/** 在庫カウントを seat_availabilities の status 件数から絶対再計算（相関サブクエリ・冪等）。 */
function recomputeSeatCounts(showingId: string): ProjectionStmt {
  const countByStatus = (status: "available" | "held" | "booked") =>
    sql`(select count(*) from ${seatAvailabilities} where ${seatAvailabilities.showingId} = ${salesDashboards.showingId} and ${seatAvailabilities.status} = ${status})`;
  return db
    .update(salesDashboards)
    .set({
      availableSeats: countByStatus("available"),
      heldSeats: countByStatus("held"),
      bookedSeats: countByStatus("booked"),
    })
    .where(eq(salesDashboards.showingId, showingId));
}

/**
 * 売上/件数を reservations から絶対再計算する SET 句（相関サブクエリ・sales_dashboards.showing_id に紐付け）。
 * - holdCount  : hold 到達予約数（status が initiated/failed 以外＝期限切れ/取消も「到達済み」として累積）。
 *                1 予約=1 hold なので旧 `SeatsHeld` 回数累積と実質等価。
 * - bookedCount: confirmed 予約数。
 * - grossAmount/feeAmount: confirmed 予約の固定額合計。
 */
function reservationStatsSet() {
  const where = (extra: ReturnType<typeof sql>) =>
    sql`from ${reservations} where ${reservations.showingId} = ${salesDashboards.showingId} and ${extra}`;
  return {
    holdCount: sql`(select count(*) ${where(sql`${reservations.status} not in ('initiated','failed')`)})`,
    bookedCount: sql`(select count(*) ${where(sql`${reservations.status} = 'confirmed'`)})`,
    grossAmount: sql`(select coalesce(sum(${reservations.totalAmount}),0) ${where(sql`${reservations.status} = 'confirmed'`)})`,
    feeAmount: sql`(select coalesce(sum(${reservations.applicationFeeAmount}),0) ${where(sql`${reservations.status} = 'confirmed'`)})`,
  };
}

/** showingId を直接指定して reservations 由来の統計を絶対再計算（ReservationConfirmed）。 */
function recomputeReservationStatsByShowing(showingId: string): ProjectionStmt {
  return db
    .update(salesDashboards)
    .set(reservationStatsSet())
    .where(eq(salesDashboards.showingId, showingId));
}

/** reservationId から showingId を引いて reservations 由来の統計を絶対再計算（ReservationHeld）。 */
function recomputeReservationStatsByReservation(
  reservationId: string,
): ProjectionStmt {
  return db
    .update(salesDashboards)
    .set(reservationStatsSet())
    .where(
      eq(
        salesDashboards.showingId,
        sql`(select ${reservations.showingId} from ${reservations} where ${reservations.reservationId} = ${reservationId})`,
      ),
    );
}
