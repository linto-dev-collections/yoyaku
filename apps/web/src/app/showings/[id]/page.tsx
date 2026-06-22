"use client";

import { Badge } from "@yoyaku/ui/components/ui/badge";
import { buttonVariants } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AsOfNote } from "@/components/as-of-note";
import { ShowingStatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { Seat, Showing } from "@/lib/api-types";
import { formatJstDateTime } from "@/lib/format";
import { riskTierLabel } from "@/lib/risk";

export default function ShowingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [showing, setShowing] = useState<Showing | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    api.showings.$get({ query: {} }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      if (!active) return;
      setShowing(data.showings.find((s) => s.showingId === id) ?? null);
    });
    api.showings[":id"].seats.$get({ param: { id } }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      if (!active) return;
      setSeats(data.seats);
      setAsOf(data.asOf);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const counts = seats
    ? {
        available: seats.filter((s) => s.status === "available").length,
        held: seats.filter((s) => s.status === "held").length,
        booked: seats.filter((s) => s.status === "booked").length,
      }
    : null;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="text-muted-foreground text-sm hover:text-foreground"
      >
        ← 公演一覧へ
      </Link>

      {showing === null ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-bold text-2xl tracking-tight">
              {showing.title}
            </h1>
            <ShowingStatusBadge status={showing.status} />
            {riskTierLabel(showing.riskTier) && (
              <Badge variant="secondary">
                {riskTierLabel(showing.riskTier)}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            {showing.venue ?? "会場未定"} ・ 開演{" "}
            {showing.startsAt != null
              ? formatJstDateTime(showing.startsAt)
              : "未定"}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>空席状況</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {counts === null ? (
            <Skeleton className="h-8" />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">空席 {counts.available}</Badge>
              <Badge variant="secondary">確保中 {counts.held}</Badge>
              <Badge variant="outline">購入済み {counts.booked}</Badge>
            </div>
          )}
          <Link
            href={`/showings/${id}/reserve`}
            className={buttonVariants({ size: "lg" })}
            aria-disabled={showing?.status !== "on_sale"}
          >
            席を選んで予約する
          </Link>
          {showing && showing.status !== "on_sale" && (
            <p className="text-muted-foreground text-sm">
              この公演は現在販売していません。
            </p>
          )}
        </CardContent>
      </Card>

      {asOf != null && <AsOfNote asOf={asOf} />}
    </div>
  );
}
