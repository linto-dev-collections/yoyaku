import { describe, expect, it } from "vitest";
import { gapDecision } from "./gap";

/**
 * consumer の収束を純粋にシミュレートする（projection-consumer.ts と同じ判定を使う）。
 * DO（正本）は seq 1..head を連続保持。到着 seq に対し:
 *   - skip : 既適用（重複/順序逆転の戻り）→ 何もしない
 *   - apply: 連続 → 適用して position 前進
 *   - gap  : 欠落 → DO から (last, head] を能動 backfill して一気に追従（NFR-04・指摘3）
 * 戻り値は「適用された seq の順序列」。これが 1..head の昇順になれば read model はイベントと一致。
 */
function simulate(
  arrivals: readonly number[],
  head: number,
): { appliedInOrder: number[]; last: number } {
  let last = 0;
  const appliedInOrder: number[] = [];
  const apply = (seq: number) => {
    appliedInOrder.push(seq);
    last = seq;
  };
  for (const seq of arrivals) {
    const decision = gapDecision(seq, last);
    if (decision === "skip") continue;
    if (decision === "apply") {
      apply(seq);
      continue;
    }
    // gap: DO から欠落分 (last, head] を連続適用（backfill）。
    for (let s = last + 1; s <= head; s++) apply(s);
  }
  return { appliedInOrder, last };
}

const ascending = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => i + 1);

describe("projection convergence under reorder / duplicate / gap injection", () => {
  const head = 6;
  const expected = ascending(head); // [1..6]

  it("applies an in-order stream exactly once each", () => {
    const { appliedInOrder, last } = simulate(ascending(head), head);
    expect(appliedInOrder).toEqual(expected);
    expect(last).toBe(head);
  });

  it("ignores duplicates (at-least-once redelivery) and stays consistent", () => {
    const { appliedInOrder, last } = simulate(
      [1, 1, 2, 2, 2, 3, 4, 4, 5, 6, 6],
      head,
    );
    expect(appliedInOrder).toEqual(expected);
    expect(last).toBe(head);
  });

  it("recovers from out-of-order arrival via backfill", () => {
    // 5 が先着 → gap → (0,6] を backfill して 1..6 を一気に適用。残りは skip。
    const { appliedInOrder, last } = simulate([5, 1, 2, 3, 4, 6], head);
    expect(appliedInOrder).toEqual(expected);
    expect(last).toBe(head);
  });

  it("recovers from a missing message via backfill (no loss)", () => {
    // 3 が欠落して 4 が来る → gap → backfill が 3 と 4 を埋める。
    const { appliedInOrder, last } = simulate([1, 2, 4, 5, 6], head);
    expect(appliedInOrder).toEqual(expected);
    expect(last).toBe(head);
  });

  it("converges for adversarial reorder + duplicate + gap combined", () => {
    const { appliedInOrder, last } = simulate(
      [6, 6, 2, 1, 1, 4, 3, 5, 2, 6],
      head,
    );
    expect(appliedInOrder).toEqual(expected);
    expect(last).toBe(head);
  });
});
