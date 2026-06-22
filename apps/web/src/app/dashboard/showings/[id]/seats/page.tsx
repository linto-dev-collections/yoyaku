"use client";

import { Alert, AlertDescription } from "@yoyaku/ui/components/ui/alert";
import { Badge } from "@yoyaku/ui/components/ui/badge";
import { Button, buttonVariants } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Input } from "@yoyaku/ui/components/ui/input";
import { Label } from "@yoyaku/ui/components/ui/label";
import { toast } from "@yoyaku/ui/components/ui/sonner";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ShowingStatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { Seat, Showing } from "@/lib/api-types";
import { errorMessageFrom, readJson, statusMessage } from "@/lib/http";
import { useActiveOrg } from "@/lib/use-active-org";

export default function SeatsPage() {
  const { id } = useParams<{ id: string }>();
  const { orgId } = useActiveOrg();
  const [showing, setShowing] = useState<Showing | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSeats = useCallback(async () => {
    const res = await api.showings[":id"].seats.$get({ param: { id } });
    if (res.ok) setSeats((await res.json()).seats);
  }, [id]);

  const loadHeader = useCallback(async () => {
    if (!orgId) return;
    const res = await api.showings.$get({ query: { organizationId: orgId } });
    if (res.ok) {
      const d = await res.json();
      setShowing(d.showings.find((s) => s.showingId === id) ?? null);
    }
  }, [id, orgId]);

  useEffect(() => {
    loadSeats();
  }, [loadSeats]);
  useEffect(() => {
    loadHeader();
  }, [loadHeader]);

  async function importSeats(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const section = String(f.get("section") ?? "").trim();
    const rows = String(f.get("rows") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    const perRow = Number(f.get("perRow") ?? 0);
    const ticketTypeId = String(f.get("ticketTypeId") ?? "general").trim();
    if (!section || rows.length === 0 || perRow <= 0) {
      toast.error("区画・行・1行あたりの席数を入力してください。");
      return;
    }
    const generated = rows.flatMap((row) =>
      Array.from({ length: perRow }, (_, i) => ({
        seatId: `${row}-${i + 1}`,
        rowLabel: row,
        seatNumber: String(i + 1),
        ticketTypeId,
      })),
    );
    setBusy(true);
    const res = await api.showings[":id"]["seats:import"].$post({
      param: { id },
      json: { section, seats: generated },
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(await errorMessageFrom(res));
      return;
    }
    toast.success(`${generated.length} 席を投入しました。`);
    await loadSeats();
  }

  async function publish() {
    setBusy(true);
    const res = await api.showings[":id"].publish.$post({ param: { id } });
    setBusy(false);
    if (res.ok) {
      toast.success("公開しました（販売中）。");
      await loadHeader();
      return;
    }
    // Connect 未設定は導線つきで案内。throw 由来の 409 は型に出ないため body で判定。
    const body = await readJson<{ error?: string }>(res);
    if (body?.error === "connect_not_ready") {
      toast.error(
        "公開には Stripe Connect の設定が必要です。Connect 設定を完了してください。",
      );
      return;
    }
    toast.error(statusMessage(res.status, body));
  }

  async function unpublish() {
    setBusy(true);
    const res = await api.showings[":id"].unpublish.$post({ param: { id } });
    setBusy(false);
    if (!res.ok) {
      toast.error(await errorMessageFrom(res));
      return;
    }
    toast.success("非公開にしました（下書き）。");
    await loadHeader();
  }

  const counts = seats
    ? {
        total: seats.length,
        available: seats.filter((s) => s.status === "available").length,
      }
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        href="/dashboard/showings"
        className="text-muted-foreground text-sm hover:text-foreground"
      >
        ← 公演一覧へ
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="font-bold text-2xl tracking-tight">
          {showing?.title ?? "座席投入・公開"}
        </h1>
        {showing && <ShowingStatusBadge status={showing.status} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>座席を投入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={importSeats} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="section">区画（section）</Label>
              <Input id="section" name="section" defaultValue="1F" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rows">行ラベル（カンマ区切り）</Label>
                <Input id="rows" name="rows" defaultValue="A,B,C" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="perRow">1 行あたりの席数</Label>
                <Input
                  id="perRow"
                  name="perRow"
                  type="number"
                  min={1}
                  defaultValue={10}
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ticketTypeId">席種 ID</Label>
              <Input
                id="ticketTypeId"
                name="ticketTypeId"
                defaultValue="general"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={busy || showing?.status !== "draft"}
            >
              この区画を投入
            </Button>
          </form>
          {counts && (
            <div className="flex gap-2">
              <Badge variant="outline">投入済み {counts.total} 席</Badge>
              <Badge variant="default">空席 {counts.available}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>公開</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <AlertDescription>
              公開すると販売を開始します。事前に Stripe Connect
              の設定を完了してください。
              <Link href="/dashboard/connect" className="ml-1 underline">
                Connect 設定へ
              </Link>
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button
              onClick={publish}
              disabled={busy || showing?.status === "on_sale"}
            >
              公開する
            </Button>
            <Button
              variant="outline"
              onClick={unpublish}
              disabled={busy || showing?.status !== "on_sale"}
            >
              非公開にする
            </Button>
            <Link
              href={`/dashboard/showings/${id}/sales`}
              className={buttonVariants({ variant: "ghost" })}
            >
              売上を見る
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
