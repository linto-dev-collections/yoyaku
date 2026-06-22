"use client";

import { buttonVariants } from "@yoyaku/ui/components/ui/button";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@yoyaku/ui/components/ui/table";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AsOfNote } from "@/components/as-of-note";
import { ShowingStatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { Showing } from "@/lib/api-types";
import { formatJstDateTime } from "@/lib/format";
import { useActiveOrg } from "@/lib/use-active-org";

export default function DashboardShowingsPage() {
  const { orgId, isPending } = useActiveOrg();
  const [showings, setShowings] = useState<Showing[] | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    api.showings
      .$get({ query: { organizationId: orgId } })
      .then(async (res) => {
        if (!res.ok) return;
        const d = await res.json();
        if (!active) return;
        setShowings(d.showings);
        setAsOf(d.asOf);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">公演</h1>
        <Link href="/dashboard/showings/new" className={buttonVariants()}>
          新規公演
        </Link>
      </div>

      {!isPending && !orgId ? (
        <p className="text-muted-foreground text-sm">
          先に
          <Link href="/dashboard/organization" className="underline">
            組織を作成・選択
          </Link>
          してください。
        </p>
      ) : showings === null ? (
        <Skeleton className="h-40" />
      ) : showings.length === 0 ? (
        <p className="text-muted-foreground text-sm">公演がありません。</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>公演名</TableHead>
              <TableHead>状態</TableHead>
              <TableHead>開演</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showings.map((s) => (
              <TableRow key={s.showingId}>
                <TableCell className="font-medium">{s.title}</TableCell>
                <TableCell>
                  <ShowingStatusBadge status={s.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {s.startsAt != null ? formatJstDateTime(s.startsAt) : "未定"}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Link
                    href={`/dashboard/showings/${s.showingId}/seats`}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    座席・公開
                  </Link>
                  <Link
                    href={`/dashboard/showings/${s.showingId}/sales`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    売上
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {asOf != null && <AsOfNote asOf={asOf} />}
    </div>
  );
}
