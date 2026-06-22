/** 投影適用の判定（cqrs-es-example-js の advanceProjection 相当・純粋）。 */
export type GapDecision = "skip" | "apply" | "gap";

/**
 * あるソース集約の position（last 適用 seq）に対し、到着 seq をどう扱うか。
 * - seq <= last: 重複（既適用）→ skip（ack）
 * - seq == last+1: 連続 → apply
 * - seq > last+1: 欠落（順序逆転）→ gap（backfill/retry）
 *
 * 注: position は「購読ストリームの全イベント」で前進させる（投影が扱わない eventType でも
 * 空適用で position を進める）。これにより seq 連続性が保たれ、本判定が正しく機能する。
 */
export function gapDecision(seq: number, last: number): GapDecision {
  if (seq <= last) return "skip";
  if (seq === last + 1) return "apply";
  return "gap";
}
