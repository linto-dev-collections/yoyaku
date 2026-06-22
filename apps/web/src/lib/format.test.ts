import { describe, expect, it } from "vitest";
import {
  epochMsToJstWallClock,
  formatJstDateTime,
  formatMinorAmount,
  formatRemaining,
  jstWallClockToEpochMs,
  remainingMs,
} from "./format";

describe("formatMinorAmount", () => {
  it("JPY は最小単位=円（小数桁 0）", () => {
    // 全角記号や桁区切りはロケール依存だが、数値 5000 が含まれることを確認。
    expect(formatMinorAmount(5000, "JPY")).toContain("5,000");
  });

  it("USD は最小単位=セント（/100 して表示）", () => {
    expect(formatMinorAmount(1234, "USD")).toContain("12.34");
  });
});

describe("remainingMs / formatRemaining", () => {
  it("残り時間は負にならない", () => {
    expect(remainingMs(1000, 5000)).toBe(0);
    expect(remainingMs(5000, 1000)).toBe(4000);
  });

  it('"M:SS" 整形（秒は 2 桁ゼロ埋め）', () => {
    expect(formatRemaining(9 * 60_000 + 58_000)).toBe("9:58");
    expect(formatRemaining(5_000)).toBe("0:05");
    expect(formatRemaining(0)).toBe("0:00");
  });
});

describe("JST 壁時計 ⇄ epoch ms（UTC+9 固定・DST 無し）", () => {
  it("壁時計文字列を JST として epoch ms へ", () => {
    // 2026-07-01 19:00 JST = 2026-07-01 10:00 UTC
    expect(jstWallClockToEpochMs("2026-07-01T19:00")).toBe(
      Date.UTC(2026, 6, 1, 10, 0, 0),
    );
  });

  it("不正文字列は null", () => {
    expect(jstWallClockToEpochMs("")).toBe(null);
    expect(jstWallClockToEpochMs("not-a-date")).toBe(null);
  });

  it("round-trip（epoch ms → 壁時計 → epoch ms）が一致", () => {
    const ms = Date.UTC(2026, 6, 1, 10, 0, 0);
    const wall = epochMsToJstWallClock(ms);
    expect(wall).toBe("2026-07-01T19:00");
    expect(jstWallClockToEpochMs(wall)).toBe(ms);
  });
});

describe("formatJstDateTime", () => {
  it("UTC 深夜は JST では翌日午前", () => {
    // 2026-03-01T15:00:00Z = 2026-03-02 00:00 JST
    const s = formatJstDateTime(Date.UTC(2026, 2, 1, 15, 0, 0));
    expect(s).toContain("2026");
    expect(s).toContain("03");
    expect(s).toContain("02");
  });
});
