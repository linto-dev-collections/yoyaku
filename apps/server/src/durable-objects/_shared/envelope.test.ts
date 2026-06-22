import { describe, expect, it } from "vitest";
import { type OutboxEnvelopeRow, toEnvelope } from "./envelope";

const row: OutboxEnvelopeRow = {
  seq: 7,
  eventId: "01J0EVENT",
  aggregateId: "01J0SHOWING",
  aggregateType: "Showing",
  eventType: "SeatsHeld",
  schemaVersion: 1,
  payload: { type: "SeatsHeld", seatIds: ["A-1"] },
  metadata: { correlationId: "corr-1", actor: "user-1" },
  occurredAt: new Date(1_700_000_000_000),
};

describe("toEnvelope", () => {
  it("maps an outbox row to a ProjectionMessage", () => {
    expect(toEnvelope(row)).toEqual({
      seq: 7,
      eventId: "01J0EVENT",
      aggregateId: "01J0SHOWING",
      aggregateType: "Showing",
      eventType: "SeatsHeld",
      schemaVersion: 1,
      payload: { type: "SeatsHeld", seatIds: ["A-1"] },
      metadata: { correlationId: "corr-1", actor: "user-1" },
      occurredAt: 1_700_000_000_000,
    });
  });

  it("converts occurredAt (Date) to epoch ms (number)", () => {
    expect(typeof toEnvelope(row).occurredAt).toBe("number");
    expect(toEnvelope(row).occurredAt).toBe(row.occurredAt.getTime());
  });
});
