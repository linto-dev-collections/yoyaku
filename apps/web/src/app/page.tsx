"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Input } from "@yoyaku/ui/components/ui/input";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AsOfNote } from "@/components/as-of-note";
import { ShowingStatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { Showing } from "@/lib/api-types";
import { formatJstDateTime } from "@/lib/format";

/** トップ＝公演検索（販売中の公演一覧・FR-35）。検索はタイトル/会場のクライアントフィルタ。 */
export default function HomePage() {
  const [showings, setShowings] = useState<Showing[] | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let active = true;
    api.showings.$get({ query: {} }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      if (!active) return;
      setShowings(data.showings);
      setAsOf(data.asOf);
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!showings) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return showings;
    return showings.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        (s.venue ?? "").toLowerCase().includes(needle),
    );
  }, [showings, q]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-bold text-2xl tracking-tight">公演を探す</h1>
        <p className="text-muted-foreground text-sm">
          販売中の公演から席を選んで予約できます。
        </p>
      </div>

      <Input
        type="search"
        placeholder="公演名・会場で検索"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="公演を検索"
        className="max-w-md"
      />

      {filtered === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          該当する公演がありません。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((s) => (
            <Link key={s.showingId} href={`/showings/${s.showingId}`}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{s.title}</CardTitle>
                    <ShowingStatusBadge status={s.status} />
                  </div>
                  <CardDescription>{s.venue ?? "会場未定"}</CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">
                  開演{" "}
                  {s.startsAt != null ? formatJstDateTime(s.startsAt) : "未定"}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {asOf != null && <AsOfNote asOf={asOf} />}
    </div>
  );
}
