import { describe, expect, it } from "vitest";
import {
  pickSnapshotSeqsToPrune,
  SNAPSHOT_EVERY,
  shouldSnapshot,
  snapshotPartByteSize,
} from "./snapshot";

describe("shouldSnapshot", () => {
  it("triggers once head advanced >= SNAPSHOT_EVERY since last snapshot", () => {
    expect(shouldSnapshot(SNAPSHOT_EVERY, 0)).toBe(true);
    expect(shouldSnapshot(SNAPSHOT_EVERY - 1, 0)).toBe(false);
    expect(shouldSnapshot(250, 150)).toBe(true);
    expect(shouldSnapshot(249, 150)).toBe(false);
  });

  it("honors a custom interval", () => {
    expect(shouldSnapshot(10, 5, 5)).toBe(true);
    expect(shouldSnapshot(9, 5, 5)).toBe(false);
  });
});

describe("pickSnapshotSeqsToPrune", () => {
  it("keeps the newest N generations and prunes the rest", () => {
    expect(
      pickSnapshotSeqsToPrune([100, 200, 300, 400, 500, 600, 700], 5),
    ).toEqual([200, 100]);
  });

  it("dedupes seqs (multi-part generations) before selecting", () => {
    // seq 300 has 2 parts → still one generation.
    expect(pickSnapshotSeqsToPrune([300, 300, 200, 100], 2)).toEqual([100]);
  });

  it("prunes nothing when within the keep window", () => {
    expect(pickSnapshotSeqsToPrune([100, 200], 5)).toEqual([]);
  });
});

describe("snapshotPartByteSize", () => {
  it("measures the UTF-8 byte length of the JSON", () => {
    expect(snapshotPartByteSize({ a: 1 })).toBe(
      JSON.stringify({ a: 1 }).length,
    );
    // multibyte chars count as >1 byte
    expect(snapshotPartByteSize("あ")).toBeGreaterThan(2);
  });
});
