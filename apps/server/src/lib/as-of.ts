/**
 * as-of リプレイの純粋フィルタ（FR-23/24・§5）。`occurred_at <= asOf` のイベントのみを **seq 昇順**で返す。
 * 「その時点の状態」を decider 再生で復元するための土台（DB/DO 非依存＝テスト対象）。
 * 同一 occurredAt の同着は seq で安定整列＝因果順を保つ。
 */
export function eventsAsOf<T extends { seq: number; occurredAt: number }>(
  events: readonly T[],
  asOf: number,
): T[] {
  return events
    .filter((e) => e.occurredAt <= asOf)
    .sort((a, b) => a.seq - b.seq);
}
