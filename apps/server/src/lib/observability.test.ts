import { describe, expect, it } from "vitest";
import {
  alertsFor,
  type MetricsSnapshot,
  structuredLog,
  sumCounts,
  tally,
} from "./observability";

const snapshot = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  reservationsByStatus: {},
  openExceptionsByKind: {},
  webhookEventsByStatus: {},
  openDeadLetters: 0,
  ...over,
});

describe("tally", () => {
  it("folds count rows into a keyed map", () => {
    expect(
      tally([
        { key: "confirmed", count: 3 },
        { key: "expired", count: 2 },
      ]),
    ).toEqual({ confirmed: 3, expired: 2 });
  });

  it("sums duplicate keys", () => {
    expect(
      tally([
        { key: "a", count: 1 },
        { key: "a", count: 4 },
      ]),
    ).toEqual({ a: 5 });
  });
});

describe("sumCounts", () => {
  it("adds all values", () => {
    expect(sumCounts({ a: 1, b: 2, c: 3 })).toBe(6);
    expect(sumCounts({})).toBe(0);
  });
});

describe("alertsFor", () => {
  it("returns no alerts for a healthy snapshot", () => {
    expect(
      alertsFor(snapshot({ reservationsByStatus: { confirmed: 10 } })),
    ).toEqual([]);
  });

  it("raises a critical alert for open reconciliation exceptions", () => {
    const alerts = alertsFor(
      snapshot({ openExceptionsByKind: { paid_no_seat: 2, dangling_auth: 1 } }),
    );
    const recon = alerts.find((a) => a.code === "reconciliation_open");
    expect(recon).toMatchObject({ level: "critical", value: 3 });
  });

  it("warns on failed webhooks and stuck authorized reservations", () => {
    const alerts = alertsFor(
      snapshot({
        webhookEventsByStatus: { failed: 1, processed: 9 },
        reservationsByStatus: { authorized: 4, confirmed: 1 },
      }),
    );
    expect(alerts.map((a) => a.code).sort()).toEqual([
      "authorized_backlog",
      "webhook_failed",
    ]);
  });

  it("raises a critical alert for open projection dead letters", () => {
    const alerts = alertsFor(snapshot({ openDeadLetters: 3 }));
    const dl = alerts.find((a) => a.code === "projection_dead_letters_open");
    expect(dl).toMatchObject({ level: "critical", value: 3 });
  });
});

describe("structuredLog", () => {
  it("emits a single-line JSON record with level and event", () => {
    const line = structuredLog("info", "reconciliation_run", {
      scanned: 5,
      resolved: 2,
    });
    expect(JSON.parse(line)).toEqual({
      level: "info",
      event: "reconciliation_run",
      scanned: 5,
      resolved: 2,
    });
  });
});
