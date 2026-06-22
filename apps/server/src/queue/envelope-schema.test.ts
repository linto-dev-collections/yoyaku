import { describe, expect, it } from "vitest";
import { projectionEnvelopeSchema } from "./envelope-schema";

const valid = {
  eventId: "01J0000000000000000000000A",
  aggregateType: "Showing" as const,
  aggregateId: "show_1",
  seq: 1,
  eventType: "ShowingRegistered",
  schemaVersion: 1,
  occurredAt: 1_700_000_000_000,
  payload: { anything: true },
  metadata: { correlationId: "c1", actor: "user_1" },
};

describe("projectionEnvelopeSchema", () => {
  it("accepts a well-formed envelope (payload is opaque)", () => {
    expect(projectionEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional causationId in metadata", () => {
    const r = projectionEnvelopeSchema.safeParse({
      ...valid,
      metadata: { correlationId: "c1", causationId: "x", actor: "user_1" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing top-level fields (poison) so the consumer can DLQ it", () => {
    const { eventId, ...noEventId } = valid;
    expect(projectionEnvelopeSchema.safeParse(noEventId).success).toBe(false);
  });

  it("rejects an unknown aggregateType", () => {
    const r = projectionEnvelopeSchema.safeParse({
      ...valid,
      aggregateType: "Ticket",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-integer / negative seq", () => {
    expect(
      projectionEnvelopeSchema.safeParse({ ...valid, seq: -1 }).success,
    ).toBe(false);
    expect(
      projectionEnvelopeSchema.safeParse({ ...valid, seq: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects a malformed metadata object", () => {
    const r = projectionEnvelopeSchema.safeParse({
      ...valid,
      metadata: { actor: "user_1" },
    });
    expect(r.success).toBe(false);
  });
});
