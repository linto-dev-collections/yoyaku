"use client";

import { Alert, AlertDescription } from "@yoyaku/ui/components/ui/alert";
import { Button, buttonVariants } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import { toast } from "@yoyaku/ui/components/ui/sonner";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ReservationSteps } from "@/components/reservation-steps";
import { ReservationStatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { ReservationView } from "@/lib/api-types";
import { formatMinorAmount } from "@/lib/format";
import { errorMessageFrom } from "@/lib/http";

export default function ConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<ReservationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // オーソリ（webhook 反映）を待つポーリング。authorized になればキャプチャ可、confirmed なら完了。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 20 && !cancelled; i++) {
        const res = await api.reservations[":id"].$get({ param: { id } });
        if (!res.ok) {
          if (!cancelled) setError(await errorMessageFrom(res));
          return;
        }
        const v = await res.json();
        if (cancelled) return;
        setView(v);
        if (v.status === "confirmed") {
          setDone(true);
          return;
        }
        if (v.status === "authorized") return; // キャプチャ可能
        if (v.status !== "awaiting_payment" && v.status !== "initiated") {
          setError("この予約は確定できる状態ではありません。");
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function capture() {
    setCapturing(true);
    const res = await api.reservations[":id"].capture.$post({ param: { id } });
    if (res.ok) {
      setDone(true);
      toast.success("購入が確定しました。");
      return;
    }
    toast.error(await errorMessageFrom(res));
    setCapturing(false);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <ReservationSteps current={done ? "done" : "confirm"} />
      <h1 className="font-bold text-2xl tracking-tight">
        {done ? "購入が確定しました" : "最終確定"}
      </h1>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : view === null ? (
        <Skeleton className="h-56" />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>予約内容</CardTitle>
              <ReservationStatusBadge status={view.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5 text-sm">
              {view.seatIds.map((s) => (
                <span
                  key={s}
                  className="rounded border bg-muted px-2 py-0.5 font-medium"
                >
                  {s}
                </span>
              ))}
            </div>
            {view.pricing && (
              <div className="flex justify-between font-medium text-sm">
                <span>合計</span>
                <span>
                  {formatMinorAmount(
                    view.pricing.totalAmount,
                    view.pricing.currency,
                  )}
                </span>
              </div>
            )}

            {done ? (
              <div className="flex gap-2">
                <Link
                  href="/me/tickets"
                  className={buttonVariants({ size: "lg" })}
                >
                  マイチケットを見る
                </Link>
                <Link
                  href="/"
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  公演一覧へ
                </Link>
              </div>
            ) : view.status === "authorized" ? (
              <Button
                className="w-full"
                size="lg"
                disabled={capturing}
                onClick={capture}
              >
                {capturing ? "確定処理中…" : "購入を確定する（キャプチャ）"}
              </Button>
            ) : (
              <p className="text-muted-foreground text-sm" aria-live="polite">
                決済を確認しています…（数秒お待ちください）
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
