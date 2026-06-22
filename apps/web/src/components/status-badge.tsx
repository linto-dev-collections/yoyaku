import { Badge } from "@yoyaku/ui/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

const SHOWING: Record<string, { label: string; variant: Variant }> = {
  draft: { label: "下書き", variant: "secondary" },
  on_sale: { label: "販売中", variant: "default" },
  closed: { label: "終了", variant: "outline" },
  sold_out: { label: "完売", variant: "destructive" },
};

const RESERVATION: Record<string, { label: string; variant: Variant }> = {
  initiated: { label: "確保処理中", variant: "secondary" },
  awaiting_payment: { label: "決済待ち", variant: "default" },
  authorized: { label: "オーソリ済み", variant: "default" },
  confirmed: { label: "確定", variant: "default" },
  cancelled: { label: "取消", variant: "outline" },
  expired: { label: "期限切れ", variant: "outline" },
  payment_failed: { label: "決済失敗", variant: "destructive" },
  failed: { label: "失敗", variant: "destructive" },
};

/** 公演ステータスのバッジ。 */
export function ShowingStatusBadge({ status }: { status: string }) {
  const s = SHOWING[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** 予約ステータスのバッジ。 */
export function ReservationStatusBadge({ status }: { status: string }) {
  const s = RESERVATION[status] ?? {
    label: status,
    variant: "outline" as const,
  };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
