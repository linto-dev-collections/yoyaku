import { describe, expect, it } from "vitest";
import { EventStoreError, err, ok } from "./result";

describe("Result", () => {
  it("ok wraps a value", () => {
    expect(ok(42)).toEqual({ type: "ok", value: 42 });
  });

  it("err wraps an error", () => {
    const e = EventStoreError.storage("boom");
    expect(err(e)).toEqual({ type: "err", error: e });
  });
});

describe("EventStoreError factories", () => {
  it("optimisticLock carries expected/actual", () => {
    const e = EventStoreError.optimisticLock(3, 5);
    expect(e).toMatchObject({
      type: "optimistic_lock_conflict",
      expected: 3,
      actual: 5,
    });
    expect(e.message).toContain("expected 3");
    expect(e.message).toContain("actual 5");
  });

  it("previouslyFailed carries the original error code", () => {
    const e = EventStoreError.previouslyFailed("seat_conflict");
    expect(e).toMatchObject({
      type: "previously_failed",
      errorCode: "seat_conflict",
    });
  });

  it("idempotencyConflict / inProgress have stable types", () => {
    expect(EventStoreError.idempotencyConflict().type).toBe(
      "idempotency_conflict",
    );
    expect(EventStoreError.inProgress().type).toBe("in_progress");
  });
});
