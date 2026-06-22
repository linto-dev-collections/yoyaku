import { describe, expect, it } from "vitest";
import { BUSINESS_TIMEZONE, businessDayKey } from "./index";

describe("BUSINESS_TIMEZONE", () => {
  it("is Asia/Tokyo", () => {
    expect(BUSINESS_TIMEZONE).toBe("Asia/Tokyo");
  });
});

describe("businessDayKey (JST day boundary)", () => {
  // 2026-03-01T15:00:00Z = 2026-03-02 00:00 JST（日境界をまたぐ）
  const midnightJst = Date.UTC(2026, 2, 1, 15, 0, 0);

  it("maps an instant to the JST calendar day, not the UTC day", () => {
    // UTC ではまだ 03-01、JST では 03-02。
    expect(businessDayKey(midnightJst)).toBe("2026-03-02");
    expect(businessDayKey(midnightJst - 1)).toBe("2026-03-01"); // 直前は前日(JST)
  });

  it("keeps an afternoon JST instant on the same JST day", () => {
    // 2026-03-02T10:00:00Z = 2026-03-02 19:00 JST
    expect(businessDayKey(Date.UTC(2026, 2, 2, 10, 0, 0))).toBe("2026-03-02");
  });

  it("honors an explicit timeZone override (UTC)", () => {
    expect(businessDayKey(midnightJst, "UTC")).toBe("2026-03-01");
  });
});
