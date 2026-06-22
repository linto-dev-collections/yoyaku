/**
 * 売上ダッシュボードの派生指標（純粋・DB 非依存＝vitest 対象）。
 *
 * 在庫カウント/売上の実体は read model（seat_availabilities / reservations）から
 * **絶対値で都度再計算**する（`queue/projections/sales-dashboards.projection.ts`）。
 * 旧来の符号付き増分（SalesIncrement）は自己修復しないため廃止した。
 */

/** コンバージョン = 確定数 / 確保数（確保が 0 なら 0）。ダッシュボードで提示。 */
export const conversionRate = (
  bookedCount: number,
  holdCount: number,
): number => (holdCount > 0 ? bookedCount / holdCount : 0);

/** 稼働率 = 確定席数 / 総席数（総席が 0 なら 0）。 */
export const occupancyRate = (
  bookedSeats: number,
  totalSeats: number,
): number => (totalSeats > 0 ? bookedSeats / totalSeats : 0);
