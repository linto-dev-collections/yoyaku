import { describe, expect, it } from "vitest";
import { conversionRate, occupancyRate } from "./sales";

// 在庫カウント/売上は read model からの絶対値再計算（SQL）へ移行したため、純粋テストは派生指標のみ。
// 集計ロジック（seat_availabilities/reservations からの再計算）は手動 E2E / 将来の統合テストで担保する。

describe("conversionRate / occupancyRate", () => {
  it("conversion = booked/hold（hold=0 は 0）", () => {
    expect(conversionRate(5, 10)).toBe(0.5);
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(3, 0)).toBe(0);
  });

  it("occupancy = booked/total（total=0 は 0）", () => {
    expect(occupancyRate(10, 100)).toBe(0.1);
    expect(occupancyRate(0, 0)).toBe(0);
    expect(occupancyRate(50, 0)).toBe(0);
  });
});
