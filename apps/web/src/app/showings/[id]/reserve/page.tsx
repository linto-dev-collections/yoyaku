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
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AsOfNote } from "@/components/as-of-note";
import { SeatMap } from "@/components/seat-map";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { api } from "@/lib/api";
import type { Seat, Showing, Ticket } from "@/lib/api-types";
import { errorMessageFrom } from "@/lib/http";
import { isHighRisk } from "@/lib/risk";
import {
  EMPTY_SELECTION,
  type SeatSelection,
  selectionRejectionMessage,
  toggleSeat,
} from "@/lib/seats";

const DEFAULT_MAX_SEATS = 4;

const activeReservationStorageKey = (showingId: string): string =>
  `yoyaku:active-reservation:${showingId}`;

const continuationHref = (ticket: Ticket): string | null => {
  if (ticket.status === "awaiting_payment") {
    return `/reservations/${ticket.reservationId}/checkout`;
  }
  if (ticket.status === "authorized") {
    return `/reservations/${ticket.reservationId}/confirm`;
  }
  return null;
};

/** 座席選択→確保（FR-35・§3.1）。all-or-nothing 同一 section・公演別上限。409 は再取得して選択リセット。 */
export default function ReservePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [showing, setShowing] = useState<Showing | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [selection, setSelection] = useState<SeatSelection>(EMPTY_SELECTION);
  const [activeReservation, setActiveReservation] = useState<Ticket | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const maxSeats = showing?.maxSeatsPerUser ?? DEFAULT_MAX_SEATS;
  const highRisk = isHighRisk(showing?.riskTier);
  const remaining = maxSeats - selection.seatIds.length;
  const continueHref =
    activeReservation != null ? continuationHref(activeReservation) : null;

  const load = useCallback(async () => {
    const res = await api.showings[":id"].seats.$get({ param: { id } });
    if (res.ok) {
      const d = await res.json();
      setSeats(d.seats);
      setAsOf(d.asOf);
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    const storageKey = activeReservationStorageKey(id);
    const mergeId = window.sessionStorage.getItem(storageKey) ?? "";
    load();
    api.showings.$get({ query: {} }).then(async (res) => {
      if (!res.ok) return;
      const d = await res.json();
      if (active)
        setShowing(d.showings.find((s) => s.showingId === id) ?? null);
    });
    api.me.tickets
      .$get({ query: mergeId.length > 0 ? { merge: mergeId } : {} })
      .then(async (res) => {
        if (!res.ok) return;
        const d = await res.json();
        const now = Date.now();
        const ticket =
          d.inProgress.find(
            (t) =>
              t.showingId === id &&
              continuationHref(t) != null &&
              (t.holdExpiresAt == null || t.holdExpiresAt > now),
          ) ?? null;
        if (active) setActiveReservation(ticket);
        if (ticket == null && mergeId.length > 0) {
          window.sessionStorage.removeItem(storageKey);
        }
      });
    return () => {
      active = false;
    };
  }, [load, id]);

  const onTurnstile = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  function onToggle(seat: Seat) {
    const r = toggleSeat(
      selection,
      { seatId: seat.seatId, section: seat.section, status: seat.status },
      maxSeats,
    );
    if (!r.ok) {
      toast.error(selectionRejectionMessage(r.reason, maxSeats));
      return;
    }
    setSelection(r.selection);
  }

  async function reserve() {
    if (continueHref != null) {
      router.push(continueHref);
      return;
    }
    if (selection.seatIds.length === 0) return;
    if (highRisk && !turnstileToken) {
      toast.error("混雑対策の確認（Turnstile）を完了してください。");
      return;
    }
    setSubmitting(true);
    const res = await api.reservations.$post(
      { json: { showingId: id, seatIds: selection.seatIds } },
      // 高リスク公演はトークンを送る（サーバが siteverify・FR-17）。
      highRisk && turnstileToken
        ? { headers: { "cf-turnstile-response": turnstileToken } }
        : undefined,
    );
    if (res.ok) {
      const d = await res.json();
      window.sessionStorage.setItem(
        activeReservationStorageKey(id),
        d.reservationId,
      );
      router.push(`/reservations/${d.reservationId}/checkout`);
      return;
    }
    // 競合（先着で取られた等）→ 文言提示・選択リセット・最新の空席を再取得（FR-37）。
    toast.error(await errorMessageFrom(res));
    setSelection(EMPTY_SELECTION);
    setTurnstileToken(null);
    await load();
    setSubmitting(false);
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/showings/${id}`}
        className="text-muted-foreground text-sm hover:text-foreground"
      >
        ← 公演詳細へ
      </Link>
      <div className="space-y-1">
        <h1 className="font-bold text-2xl tracking-tight">席を選ぶ</h1>
        <p className="text-muted-foreground text-sm">
          同じ区画から最大 {maxSeats} 席まで選べます。確保後 10
          分以内に決済してください。
        </p>
      </div>

      {highRisk && (
        <Alert>
          <AlertDescription>
            人気が集中する公演です。混雑時は順番にご案内します（公平性のための整流）。
            確認（Turnstile）の完了後に確保できます。
          </AlertDescription>
        </Alert>
      )}

      {activeReservation != null && continueHref != null && (
        <Alert>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              この公演には進行中の予約があります。確保済みの席:
              {activeReservation.seatIds.join(", ")}
            </span>
            <Link
              href={continueHref}
              className={buttonVariants({ size: "sm" })}
            >
              手続きを続ける
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent className="pt-6">
            {seats === null ? (
              <Skeleton className="h-64" />
            ) : seats.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                座席がまだ投入されていません。
              </p>
            ) : (
              <SeatMap
                seats={seats}
                selectedIds={selection.seatIds}
                onToggle={onToggle}
              />
            )}
            {asOf != null && <AsOfNote asOf={asOf} className="mt-4" />}
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>選択中の席</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selection.seatIds.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                席を選択してください。
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {selection.seatIds.map((sid) => (
                  <li key={sid} className="font-medium">
                    {sid}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground text-xs" aria-live="polite">
              あと {Math.max(0, remaining)} 席選べます（上限 {maxSeats} 席）。
            </p>
            {highRisk && <TurnstileWidget onToken={onTurnstile} />}
            <Button
              className="w-full"
              size="lg"
              disabled={
                continueHref == null &&
                (selection.seatIds.length === 0 ||
                  submitting ||
                  (highRisk && !turnstileToken))
              }
              onClick={reserve}
            >
              {continueHref != null
                ? "手続きを続ける"
                : submitting
                  ? "確保中…"
                  : `この席を確保する（${selection.seatIds.length}）`}
            </Button>
            <p className="text-muted-foreground text-xs">
              確保にはサインインが必要です。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
