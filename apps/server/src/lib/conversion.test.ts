import { describe, expect, it } from "vitest";
import { conversionStats } from "./conversion";

describe("conversionStats", () => {
  it("returns zeros when nothing reached a hold", () => {
    expect(conversionStats({ initiated: 3, failed: 2 })).toEqual({
      held: 0,
      confirmed: 0,
      abandoned: 0,
      conversionRate: 0,
      abandonmentRate: 0,
    });
  });

  it("counts holds as awaiting_payment and beyond, excluding initiated/failed", () => {
    const s = conversionStats({
      initiated: 5,
      awaiting_payment: 2,
      authorized: 1,
      confirmed: 4,
      expired: 2,
      cancelled: 1,
      failed: 9,
    });
    // held = 2+1+4+2+1 = 10, confirmed = 4
    expect(s.held).toBe(10);
    expect(s.confirmed).toBe(4);
    expect(s.abandoned).toBe(6);
    expect(s.conversionRate).toBeCloseTo(0.4);
    expect(s.abandonmentRate).toBeCloseTo(0.6);
  });

  it("treats a fully-converted cohort as conversion 1 / abandonment 0", () => {
    const s = conversionStats({ confirmed: 3 });
    expect(s.conversionRate).toBe(1);
    expect(s.abandonmentRate).toBe(0);
  });
});
