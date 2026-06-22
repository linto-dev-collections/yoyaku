import { describe, expect, it } from "vitest";
import { asRiskTier, DEFAULT_MAX_SEATS_PER_USER, riskControls } from "./risk";

describe("riskControls 導出（区分→必須対策・計画 §1）", () => {
  it("general はレート制限のみ（必須対策なし）", () => {
    expect(riskControls("general")).toEqual({
      purchaseLimit: false,
      turnstile: false,
      waitingRoom: false,
    });
  });

  it("popular は購入上限を必須化", () => {
    expect(riskControls("popular")).toEqual({
      purchaseLimit: true,
      turnstile: false,
      waitingRoom: false,
    });
  });

  it("high_risk は購入上限・Turnstile・Waiting Room すべて必須", () => {
    expect(riskControls("high_risk")).toEqual({
      purchaseLimit: true,
      turnstile: true,
      waitingRoom: true,
    });
  });
});

describe("asRiskTier 正規化", () => {
  it("既知の区分はそのまま", () => {
    expect(asRiskTier("popular")).toBe("popular");
    expect(asRiskTier("high_risk")).toBe("high_risk");
  });

  it("未知/未指定は general", () => {
    expect(asRiskTier(undefined)).toBe("general");
    expect(asRiskTier("nope")).toBe("general");
    expect(asRiskTier(null)).toBe("general");
  });
});

describe("既定購入上限", () => {
  it("既定は 4 席", () => {
    expect(DEFAULT_MAX_SEATS_PER_USER).toBe(4);
  });
});
