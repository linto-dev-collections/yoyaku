import { describe, expect, it } from "vitest";
import { computeNextAlarm } from "./alarm";

describe("computeNextAlarm", () => {
  it("returns null when nothing needs an alarm", () => {
    expect(
      computeNextAlarm({ now: 1000, outboxRemaining: 0, backstopDelayMs: 100 }),
    ).toBeNull();
  });

  it("schedules an outbox backstop when pending remains", () => {
    expect(
      computeNextAlarm({ now: 1000, outboxRemaining: 2, backstopDelayMs: 100 }),
    ).toBe(1100);
  });

  it("schedules hold expiry when set and no outbox backlog", () => {
    expect(
      computeNextAlarm({
        now: 1000,
        outboxRemaining: 0,
        backstopDelayMs: 100,
        holdExpiresAt: 5000,
      }),
    ).toBe(5000);
  });

  it("picks the earliest of backstop and hold expiry (multiplexed alarm)", () => {
    expect(
      computeNextAlarm({
        now: 1000,
        outboxRemaining: 1,
        backstopDelayMs: 100, // backstop at 1100
        holdExpiresAt: 5000,
      }),
    ).toBe(1100);
    expect(
      computeNextAlarm({
        now: 1000,
        outboxRemaining: 1,
        backstopDelayMs: 100,
        holdExpiresAt: 1050, // earlier than backstop
      }),
    ).toBe(1050);
  });
});
