import { describe, expect, it } from "vitest";
import { gapDecision } from "./gap";

describe("gapDecision", () => {
  it("skips already-applied seqs (duplicate / out-of-order replay)", () => {
    expect(gapDecision(1, 1)).toBe("skip");
    expect(gapDecision(3, 5)).toBe("skip");
    expect(gapDecision(0, 0)).toBe("skip");
  });

  it("applies the next contiguous seq", () => {
    expect(gapDecision(1, 0)).toBe("apply");
    expect(gapDecision(6, 5)).toBe("apply");
  });

  it("detects a gap when a seq is missing", () => {
    expect(gapDecision(2, 0)).toBe("gap");
    expect(gapDecision(7, 5)).toBe("gap");
  });
});
