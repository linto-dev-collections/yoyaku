import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, type SelectableSeat, toggleSeat } from "./seats";

const seat = (
  seatId: string,
  section: string | null,
  status: SelectableSeat["status"] = "available",
): SelectableSeat => ({ seatId, section, status });

describe("toggleSeat (all-or-nothing 同一 section・上限・空席)", () => {
  it("空席を追加すると section が確定する", () => {
    const r = toggleSeat(EMPTY_SELECTION, seat("A-1", "A"), 4);
    expect(r).toEqual({
      ok: true,
      selection: { section: "A", seatIds: ["A-1"] },
    });
  });

  it("同一 section の席は複数選べる", () => {
    const r1 = toggleSeat(EMPTY_SELECTION, seat("A-1", "A"), 4);
    if (!r1.ok) throw new Error("unexpected");
    const r2 = toggleSeat(r1.selection, seat("A-2", "A"), 4);
    expect(r2).toEqual({
      ok: true,
      selection: { section: "A", seatIds: ["A-1", "A-2"] },
    });
  });

  it("別 section は拒否（all-or-nothing）", () => {
    const r1 = toggleSeat(EMPTY_SELECTION, seat("A-1", "A"), 4);
    if (!r1.ok) throw new Error("unexpected");
    expect(toggleSeat(r1.selection, seat("B-1", "B"), 4)).toEqual({
      ok: false,
      reason: "different_section",
    });
  });

  it("上限超過は拒否", () => {
    const sel = { section: "A", seatIds: ["A-1", "A-2"] };
    expect(toggleSeat(sel, seat("A-3", "A"), 2)).toEqual({
      ok: false,
      reason: "max_exceeded",
    });
  });

  it("非空席（held/booked）は拒否", () => {
    expect(toggleSeat(EMPTY_SELECTION, seat("A-1", "A", "held"), 4)).toEqual({
      ok: false,
      reason: "not_available",
    });
  });

  it("既選択をトグルで解除し、空になると section も解除", () => {
    const sel = { section: "A", seatIds: ["A-1"] };
    expect(toggleSeat(sel, seat("A-1", "A"), 4)).toEqual({
      ok: true,
      selection: { section: null, seatIds: [] },
    });
  });

  it("解除しても残れば section は維持", () => {
    const sel = { section: "A", seatIds: ["A-1", "A-2"] };
    expect(toggleSeat(sel, seat("A-1", "A"), 4)).toEqual({
      ok: true,
      selection: { section: "A", seatIds: ["A-2"] },
    });
  });
});
