import { aggregateRegistryProjection } from "./aggregate-registry.projection";
import { reservationsProjection } from "./reservations.projection";
import { salesDashboardsProjection } from "./sales-dashboards.projection";
import { seatAvailabilitiesProjection } from "./seat-availabilities.projection";
import { showingsProjection } from "./showings.projection";
import { ticketTypesProjection } from "./ticket-types.projection";
import type { Projection } from "./types";

/**
 * 投影の適用順。FK 親子（showings → ticket_types / seat_availabilities）を満たすため
 * **親（showings）を先頭**に置く（各投影は別 batch なので、子の INSERT 時に親行が存在する）。
 * reservations / sales_dashboards は物理 FK 無し（論理参照）のため順序非依存。
 * sales_dashboards は Showing/Reservation の 2 ストリームを購読し売上・在庫を集約する（Phase 07・§1）。
 * aggregate_registry は追記専用・全ストリーム購読で、reproject の ID 列挙源（cold rebuild 基盤・§4.5）。
 */
export const PROJECTIONS: Projection[] = [
  showingsProjection,
  ticketTypesProjection,
  seatAvailabilitiesProjection,
  reservationsProjection,
  salesDashboardsProjection,
  aggregateRegistryProjection,
];
