import { describe, expect, it } from "vitest";
import { canonicalize, computeRequestHash } from "./idempotency";

describe("canonicalize", () => {
  it("is independent of object key order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("excludes undefined values (matches JSON semantics)", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it("is order-sensitive for arrays", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("handles nested structures deterministically", () => {
    const a = canonicalize({ x: { p: 1, q: [1, { z: 2, y: 3 }] } });
    const b = canonicalize({ x: { q: [1, { y: 3, z: 2 }], p: 1 } });
    expect(a).toBe(b);
  });

  it("distinguishes different values", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });
});

describe("computeRequestHash", () => {
  it("produces a 64-char hex SHA-256 digest", async () => {
    const hash = await computeRequestHash({
      command: "HoldSeats",
      seats: ["A-1"],
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic regardless of key order", async () => {
    const h1 = await computeRequestHash({ a: 1, b: 2 });
    const h2 = await computeRequestHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it("differs for different requests", async () => {
    const h1 = await computeRequestHash({ seats: ["A-1"] });
    const h2 = await computeRequestHash({ seats: ["A-2"] });
    expect(h1).not.toBe(h2);
  });
});
