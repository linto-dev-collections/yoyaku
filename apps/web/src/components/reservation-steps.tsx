import { cn } from "@yoyaku/ui/lib/utils";

type Step = "pay" | "confirm" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "pay", label: "決済（オーソリ）" },
  { key: "confirm", label: "最終確定" },
  { key: "done", label: "完了" },
];

/** 購入導線のステッパ（確保→決済→確定を明示・§8）。確保済み前提で残り 3 段を表示。 */
export function ReservationSteps({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-xs",
              i <= idx
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <span className={i === idx ? "font-medium" : "text-muted-foreground"}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <span className="mx-1 text-muted-foreground">→</span>
          )}
        </li>
      ))}
    </ol>
  );
}
