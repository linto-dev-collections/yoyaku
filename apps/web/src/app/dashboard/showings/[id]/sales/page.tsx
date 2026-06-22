"use client";

import { Alert, AlertDescription } from "@yoyaku/ui/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Progress } from "@yoyaku/ui/components/ui/progress";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AsOfNote } from "@/components/as-of-note";
import { api } from "@/lib/api";
import type { SalesView } from "@/lib/api-types";
import { formatMinorAmount } from "@/lib/format";
import { errorMessageFrom } from "@/lib/http";

export default function SalesPage() {
  const { id } = useParams<{ id: string }>();
  const [dash, setDash] = useState<SalesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.showings[":id"].sales.$get({ param: { id } }).then(async (res) => {
      if (!res.ok) {
        if (active) setError(await errorMessageFrom(res));
        return;
      }
      const d = await res.json();
      if (active) setDash(d);
    });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/dashboard/showings"
        className="text-muted-foreground text-sm hover:text-foreground"
      >
        ← 公演一覧へ
      </Link>
      <h1 className="font-bold text-2xl tracking-tight">販売ダッシュボード</h1>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : dash === null ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="総席数" value={String(dash.totalSeats)} />
            <Metric label="空席" value={String(dash.availableSeats)} />
            <Metric label="確保中" value={String(dash.heldSeats)} />
            <Metric label="購入済み" value={String(dash.bookedSeats)} />
            <Metric
              label="売上（総額）"
              value={formatMinorAmount(
                dash.grossAmount,
                dash.currency ?? "JPY",
              )}
            />
            <Metric
              label="手数料"
              value={formatMinorAmount(dash.feeAmount, dash.currency ?? "JPY")}
            />
            <Metric label="確保数" value={String(dash.holdCount)} />
            <Metric label="購入数" value={String(dash.bookedCount)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>稼働率・コンバージョン</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Ratio
                label="稼働率（購入席 / 総席）"
                ratio={dash.occupancy}
                detail={`${dash.bookedSeats} / ${dash.totalSeats}`}
              />
              <Ratio
                label="コンバージョン（購入 / 確保）"
                ratio={dash.conversion}
                detail={`${dash.bookedCount} / ${dash.holdCount}`}
              />
            </CardContent>
          </Card>

          <AsOfNote asOf={dash.asOf} />
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="mt-1 font-bold text-xl tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Ratio({
  label,
  ratio,
  detail,
}: {
  label: string;
  ratio: number;
  detail: string;
}) {
  const pct = Math.round(ratio * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {pct}%（{detail}）
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}
