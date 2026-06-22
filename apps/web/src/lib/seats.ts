/**
 * 座席選択の純粋ロジック（all-or-nothing 同一 section・購入上限・空席のみ）。DB/RPC 非依存＝テスト対象。
 * 確保は「同一 section・最大 N 席・available のみ」で all-or-nothing（部分確保なし）。
 */

export type SeatStatus = "available" | "held" | "booked";

export type SelectableSeat = {
  seatId: string;
  section: string | null;
  status: SeatStatus;
};

/** 選択状態（section は最初に選んだ席で確定し、空になると解除）。 */
export type SeatSelection = { section: string | null; seatIds: string[] };

export const EMPTY_SELECTION: SeatSelection = { section: null, seatIds: [] };

export type ToggleResult =
  | { ok: true; selection: SeatSelection }
  | {
      ok: false;
      reason: "not_available" | "different_section" | "max_exceeded";
    };

/**
 * 座席のトグル選択。
 * - 既選択 → 解除（空なら section も解除）。
 * - 未選択 → available かつ（未選択 section または同一 section）かつ上限未満なら追加。
 *   別 section / 上限超過 / 非空席は理由付きで拒否（UI が文言提示）。
 */
export function toggleSeat(
  selection: SeatSelection,
  seat: SelectableSeat,
  maxSeats: number,
): ToggleResult {
  if (selection.seatIds.includes(seat.seatId)) {
    const seatIds = selection.seatIds.filter((id) => id !== seat.seatId);
    return {
      ok: true,
      selection: {
        section: seatIds.length > 0 ? selection.section : null,
        seatIds,
      },
    };
  }
  if (seat.status !== "available")
    return { ok: false, reason: "not_available" };
  if (selection.section !== null && seat.section !== selection.section) {
    return { ok: false, reason: "different_section" };
  }
  if (selection.seatIds.length >= maxSeats) {
    return { ok: false, reason: "max_exceeded" };
  }
  return {
    ok: true,
    selection: {
      section: seat.section,
      seatIds: [...selection.seatIds, seat.seatId],
    },
  };
}

/** 選択拒否理由の日本語文言（トースト等で提示）。 */
export function selectionRejectionMessage(
  reason: Exclude<ToggleResult, { ok: true }>["reason"],
  maxSeats: number,
): string {
  switch (reason) {
    case "not_available":
      return "この席は確保できません（確保中/購入済み）。";
    case "different_section":
      return "同じ区画（section）内の席のみ一緒に確保できます。";
    case "max_exceeded":
      return `一度に確保できるのは最大 ${maxSeats} 席までです。`;
  }
}
