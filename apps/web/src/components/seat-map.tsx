"use client";

import { cn } from "@yoyaku/ui/lib/utils";
import type { Seat } from "@/lib/api-types";

const STATUS_LABEL: Record<string, string> = {
  available: "空席",
  held: "確保中",
  booked: "購入済み",
};

/** section→rowLabel でグルーピングし、座席番号で安定整列。 */
function groupSeats(seats: Seat[]): Map<string, Map<string, Seat[]>> {
  const sections = new Map<string, Map<string, Seat[]>>();
  for (const s of seats) {
    const section = s.section ?? "—";
    const row = s.rowLabel ?? "—";
    if (!sections.has(section)) sections.set(section, new Map());
    const rows = sections.get(section);
    if (!rows) continue;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)?.push(s);
  }
  const cmp = (a: Seat, b: Seat) =>
    (a.seatNumber ?? a.seatId).localeCompare(b.seatNumber ?? b.seatId, "en", {
      numeric: true,
    });
  for (const rows of sections.values())
    for (const list of rows.values()) list.sort(cmp);
  return sections;
}

/**
 * 空席マップ（座席表）。status で色分け、クリックで選択トグル（all-or-nothing は呼び出し側で判定）。
 * アクセシビリティ: 各席は `button`（キーボード操作可）＋ `aria-label`（座席番号/状態）＋ `aria-pressed`。
 */
export function SeatMap({
  seats,
  selectedIds,
  onToggle,
}: {
  seats: Seat[];
  selectedIds: string[];
  onToggle: (seat: Seat) => void;
}) {
  const sections = groupSeats(seats);
  const selected = new Set(selectedIds);

  return (
    <div className="space-y-6">
      <Legend />
      {[...sections.entries()].map(([section, rows]) => (
        <div key={section} className="space-y-2">
          <h3 className="font-medium text-muted-foreground text-sm">
            区画 {section}
          </h3>
          <div className="space-y-1">
            {[...rows.entries()].map(([row, list]) => (
              <div key={row} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-right text-muted-foreground text-xs">
                  {row}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((seat) => {
                    const isSelected = selected.has(seat.seatId);
                    const selectable =
                      seat.status === "available" || isSelected;
                    return (
                      <button
                        key={seat.seatId}
                        type="button"
                        aria-label={`座席 ${seat.seatId}（${STATUS_LABEL[seat.status] ?? seat.status}）`}
                        aria-pressed={isSelected}
                        disabled={!selectable}
                        onClick={() => onToggle(seat)}
                        className={cn(
                          "size-9 rounded-md border text-center font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isSelected &&
                            "border-primary bg-primary text-primary-foreground",
                          !isSelected &&
                            seat.status === "available" &&
                            "border-border bg-background hover:bg-muted",
                          !isSelected &&
                            seat.status === "held" &&
                            "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-800",
                          !isSelected &&
                            seat.status === "booked" &&
                            "cursor-not-allowed border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {seat.seatNumber ?? seat.seatId}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs">
      <LegendItem className="border-border bg-background" label="空席" />
      <LegendItem
        className="border-primary bg-primary"
        label="選択中"
        text="text-primary-foreground"
      />
      <LegendItem className="border-amber-300 bg-amber-100" label="確保中" />
      <LegendItem className="border-border bg-muted" label="購入済み" />
    </div>
  );
}

function LegendItem({
  className,
  label,
  text,
}: {
  className: string;
  label: string;
  text?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-4 rounded border", className, text)} />
      {label}
    </span>
  );
}
