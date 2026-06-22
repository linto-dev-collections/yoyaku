/**
 * コンバージョン/離脱の運用集計（FR-24・純粋）。予約 read model の status 件数から
 * 「確保→購入」率と「確保したが買わなかった」率を導く（DB 非依存＝vitest 対象）。
 * 設計時未想定の問いも、過去イベント再生で read model を作れば同じ純粋関数で集計できる（ES の強み・§5）。
 */

/** 席を確保できた（= awaiting_payment 以降に到達した）とみなす status。initiated/failed は確保前。 */
const HELD_STATUSES = [
  "awaiting_payment",
  "authorized",
  "confirmed",
  "cancelled",
  "expired",
  "payment_failed",
] as const;

export type ConversionStats = {
  /** 確保に到達した予約数（分母）。 */
  held: number;
  /** 確定（購入完了）数。 */
  confirmed: number;
  /** 確保したが未確定（取消/失効/失敗）= 離脱数。 */
  abandoned: number;
  /** 確定率 = confirmed / held（held=0 は 0）。 */
  conversionRate: number;
  /** 離脱率 = abandoned / held（held=0 は 0）。 */
  abandonmentRate: number;
};

/** status 件数（`tally` 済みマップ）からコンバージョン統計を計算。 */
export function conversionStats(
  statusCounts: Record<string, number>,
): ConversionStats {
  const held = HELD_STATUSES.reduce(
    (sum, s) => sum + (statusCounts[s] ?? 0),
    0,
  );
  const confirmed = statusCounts.confirmed ?? 0;
  const abandoned = held - confirmed;
  return {
    held,
    confirmed,
    abandoned,
    conversionRate: held > 0 ? confirmed / held : 0,
    abandonmentRate: held > 0 ? abandoned / held : 0,
  };
}
