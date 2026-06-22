import { describe, expect, it } from "vitest";
import { archivableFloorSeq } from "./archive";

describe("archivableFloorSeq", () => {
  it("returns 0 when there are no snapshots (nothing reconstructable yet)", () => {
    expect(archivableFloorSeq([], 5)).toBe(0);
  });

  it("returns 0 when keep is non-positive", () => {
    expect(archivableFloorSeq([100, 200], 0)).toBe(0);
    expect(archivableFloorSeq([100, 200], -1)).toBe(0);
  });

  it("returns the only snapshot seq when fewer than keep generations exist", () => {
    expect(archivableFloorSeq([100], 5)).toBe(100);
    expect(archivableFloorSeq([100, 200, 300], 5)).toBe(100);
  });

  it("returns the oldest RETAINED snapshot seq, dropping older generations", () => {
    // keep=3 → retain 500,400,300 ; oldest retained = 300 → prune events seq<=300
    expect(archivableFloorSeq([100, 200, 300, 400, 500], 3)).toBe(300);
  });

  it("is order- and duplicate-insensitive", () => {
    expect(archivableFloorSeq([500, 100, 300, 200, 400, 400], 3)).toBe(300);
  });

  it("uses the default keep when omitted", () => {
    // default KEEP_SNAPSHOT_COUNT = 5 → retain 600..200, oldest retained = 200
    expect(archivableFloorSeq([100, 200, 300, 400, 500, 600])).toBe(200);
  });
});
