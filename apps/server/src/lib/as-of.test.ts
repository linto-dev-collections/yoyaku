import { describe, expect, it } from "vitest";
import { eventsAsOf } from "./as-of";

// seq と occurredAt のみを持つ最小イベント（replayAsOf が読む形）。
const ev = (seq: number, occurredAt: number) => ({ seq, occurredAt });

describe("eventsAsOf (occurred_at <= asOf フィルタ・seq 昇順)", () => {
  const unordered = [ev(3, 300), ev(1, 100), ev(2, 200)];

  it("asOf 以前のイベントだけを seq 昇順で返す", () => {
    expect(eventsAsOf(unordered, 200)).toEqual([ev(1, 100), ev(2, 200)]);
  });

  it("境界（occurredAt == asOf）は含む", () => {
    expect(eventsAsOf(unordered, 100)).toEqual([ev(1, 100)]);
  });

  it("最古より前は空", () => {
    expect(eventsAsOf(unordered, 99)).toEqual([]);
  });

  it("十分大きい asOf は全件を seq 昇順で返す", () => {
    expect(eventsAsOf(unordered, 1000)).toEqual([
      ev(1, 100),
      ev(2, 200),
      ev(3, 300),
    ]);
  });

  it("入力配列を破壊しない（純粋）", () => {
    const input = [ev(2, 200), ev(1, 100)];
    eventsAsOf(input, 1000);
    expect(input).toEqual([ev(2, 200), ev(1, 100)]);
  });
});
