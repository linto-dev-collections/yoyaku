import { KEEP_SNAPSHOT_COUNT } from "./snapshot";

/**
 * アーカイブ/プルーン可能な seq の上限（純粋・NFR-14/16）。
 *
 * events は追記専用で増え続けるため、**snapshot で再構築できる古い範囲**を R2 へ退避し DO から削る。
 * `loadState` は最新 snapshot＋それ以降の events のみ参照するため、最新 snapshot より前の events は
 * ライブ復元には不要。ただし as-of/全リプレイの粒度を保つため、保持世代の**最古 snapshot seq**を
 * 床（floor）とし、`seq <= floor` の events のみをアーカイブ対象にする（最古保持 snapshot がその状態を内包）。
 *
 * - snapshot が無い（=まだ短い集約）→ 0（何もアーカイブしない＝安全側）。
 * - 戻り値 `floor`: `seq <= floor` の events は最古保持 snapshot から再構築可能＝R2 退避後にプルーン可。
 */
export function archivableFloorSeq(
  snapshotSeqs: readonly number[],
  keep: number = KEEP_SNAPSHOT_COUNT,
): number {
  if (keep <= 0) return 0;
  const distinctDesc = [...new Set(snapshotSeqs)].sort((a, b) => b - a);
  if (distinctDesc.length === 0) return 0;
  const retained = distinctDesc.slice(0, keep);
  // 最古の保持 snapshot seq（= 配列末尾）。これ以下の events は当 snapshot に内包され再構築可能。
  return retained[retained.length - 1] ?? 0;
}
