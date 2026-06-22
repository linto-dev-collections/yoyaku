"use client";

import { Button } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Input } from "@yoyaku/ui/components/ui/input";
import { Label } from "@yoyaku/ui/components/ui/label";
import { toast } from "@yoyaku/ui/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { api } from "@/lib/api";
import { jstWallClockToEpochMs } from "@/lib/format";
import { errorMessageFrom } from "@/lib/http";
import { useActiveOrg } from "@/lib/use-active-org";

// クライアント側の二重検証（サーバの registerShowingSchema と対応）。
const formSchema = z.object({
  title: z.string().min(1, "公演名を入力してください"),
  venue: z.string().optional(),
  startsAtMs: z.number().int().positive("開演日時を入力してください"),
  currency: z.string().length(3),
  ticketName: z.string().min(1, "席種名を入力してください"),
  unitAmount: z.number().int().nonnegative("価格は 0 以上で入力してください"),
  totalSeats: z.number().int().positive("総席数は 1 以上で入力してください"),
  // 公平性/不正対策（Phase 09・NFR-15/FR-15）。
  riskTier: z.enum(["general", "popular", "high_risk"]),
  maxSeatsPerUser: z
    .number()
    .int()
    .positive("購入上限は 1 以上で入力してください")
    .max(100),
});

type TicketType = { ticketTypeId: string; name: string; unitAmount: number };

export default function NewShowingPage() {
  const { orgId } = useActiveOrg();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) {
      toast.error("有効な組織がありません。先に組織を作成・選択してください。");
      return;
    }
    const f = new FormData(e.currentTarget);
    const parsed = formSchema.safeParse({
      title: String(f.get("title") ?? "").trim(),
      venue: String(f.get("venue") ?? "").trim() || undefined,
      startsAtMs: jstWallClockToEpochMs(String(f.get("startsAt") ?? "")) ?? 0,
      currency: String(f.get("currency") ?? "JPY"),
      ticketName: String(f.get("ticketName") ?? "").trim(),
      unitAmount: Number(f.get("unitAmount") ?? 0),
      totalSeats: Number(f.get("totalSeats") ?? 0),
      riskTier: String(f.get("riskTier") ?? "general"),
      maxSeatsPerUser: Number(f.get("maxSeatsPerUser") ?? 4),
    });
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "入力を確認してください。",
      );
      return;
    }
    const v = parsed.data;
    const salesStartMs = jstWallClockToEpochMs(
      String(f.get("salesStartAt") ?? ""),
    );
    const salesEndMs = jstWallClockToEpochMs(String(f.get("salesEndAt") ?? ""));
    const ticketTypes: TicketType[] = [
      {
        ticketTypeId: "general",
        name: v.ticketName,
        unitAmount: v.unitAmount,
      },
    ];

    setSubmitting(true);
    const res = await api.showings.$post(
      {
        json: {
          organizationId: orgId,
          title: v.title,
          venue: v.venue,
          startsAt: v.startsAtMs,
          salesStartAt: salesStartMs ?? undefined,
          salesEndAt: salesEndMs ?? undefined,
          currency: v.currency,
          ticketTypes: ticketTypes.map((t) => ({ ...t, currency: v.currency })),
          totalSeats: v.totalSeats,
          riskTier: v.riskTier,
          maxSeatsPerUser: v.maxSeatsPerUser,
        },
      },
      { headers: { "Idempotency-Key": crypto.randomUUID() } },
    );
    if (!res.ok) {
      toast.error(await errorMessageFrom(res));
      setSubmitting(false);
      return;
    }
    const { showingId } = await res.json();
    toast.success("公演を登録しました。座席を投入してください。");
    router.push(`/dashboard/showings/${showingId}/seats`);
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="font-bold text-2xl tracking-tight">公演を登録</h1>
      <p className="text-muted-foreground text-sm">
        まず下書きとして登録します。続けて座席を投入し、公開すると販売開始です。
      </p>
      <Card>
        <CardHeader>
          <CardTitle>公演情報</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <Row label="公演名" htmlFor="title">
              <Input id="title" name="title" required />
            </Row>
            <Row label="会場（任意）" htmlFor="venue">
              <Input id="venue" name="venue" />
            </Row>
            <Row label="開演日時（JST）" htmlFor="startsAt">
              <Input
                id="startsAt"
                name="startsAt"
                type="datetime-local"
                required
              />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label="販売開始（任意・JST）" htmlFor="salesStartAt">
                <Input
                  id="salesStartAt"
                  name="salesStartAt"
                  type="datetime-local"
                />
              </Row>
              <Row label="販売終了（任意・JST）" htmlFor="salesEndAt">
                <Input
                  id="salesEndAt"
                  name="salesEndAt"
                  type="datetime-local"
                />
              </Row>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Row label="通貨" htmlFor="currency">
                <Input
                  id="currency"
                  name="currency"
                  defaultValue="JPY"
                  maxLength={3}
                  required
                />
              </Row>
              <Row label="総席数" htmlFor="totalSeats">
                <Input
                  id="totalSeats"
                  name="totalSeats"
                  type="number"
                  min={1}
                  required
                />
              </Row>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Row label="席種名" htmlFor="ticketName">
                <Input
                  id="ticketName"
                  name="ticketName"
                  defaultValue="一般"
                  required
                />
              </Row>
              <Row label="単価（最小単位）" htmlFor="unitAmount">
                <Input
                  id="unitAmount"
                  name="unitAmount"
                  type="number"
                  min={0}
                  defaultValue={5000}
                  required
                />
              </Row>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Row label="負荷/リスク区分" htmlFor="riskTier">
                <select
                  id="riskTier"
                  name="riskTier"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  defaultValue="general"
                >
                  <option value="general">一般</option>
                  <option value="popular">人気（購入上限を強調）</option>
                  <option value="high_risk">
                    超人気（Turnstile・整流を必須）
                  </option>
                </select>
              </Row>
              <Row label="購入上限（席/人）" htmlFor="maxSeatsPerUser">
                <Input
                  id="maxSeatsPerUser"
                  name="maxSeatsPerUser"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={4}
                  required
                />
              </Row>
            </div>
            <p className="text-muted-foreground text-xs">
              超人気区分は確保/決済前に Turnstile
              を必須化し、混雑時は順番にご案内します（公平性のための整流）。
            </p>
            <Button type="submit" disabled={submitting}>
              {submitting ? "登録中…" : "下書きとして登録"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
