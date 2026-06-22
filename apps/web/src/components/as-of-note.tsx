import { cn } from "@yoyaku/ui/lib/utils";
import { formatAsOf } from "@/lib/format";

/** 結果整合の鮮度提示（FR-37）。読みモデルのラグを `asOf` で明示する。 */
export function AsOfNote({
  asOf,
  className,
}: {
  asOf: number;
  className?: string;
}) {
  return (
    <p className={cn("text-muted-foreground text-xs", className)}>
      {formatAsOf(asOf)}の情報です（反映に数秒かかることがあります）。
    </p>
  );
}
