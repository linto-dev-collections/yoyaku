"use client";

import { Alert, AlertDescription } from "@yoyaku/ui/components/ui/alert";
import { buttonVariants } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@yoyaku/ui/components/ui/tabs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AsOfNote } from "@/components/as-of-note";
import { ReservationStatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { MyTickets, Ticket } from "@/lib/api-types";
import { formatMinorAmount } from "@/lib/format";

export default function MyTicketsPage() {
  const [data, setData] = useState<MyTickets | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let active = true;
    api.me.tickets.$get({ query: {} }).then(async (res) => {
      if (res.status === 401) {
        if (active) setUnauthorized(true);
        return;
      }
      if (!res.ok) return;
      const d = await res.json();
      if (active) setData(d);
    });
    return () => {
      active = false;
    };
  }, []);

  if (unauthorized) {
    return (
      <Alert>
        <AlertDescription>
          マイチケットの表示にはサインインが必要です。右上からサインインしてください。
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-bold text-2xl tracking-tight">マイチケット</h1>
      {data === null ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <Tabs defaultValue="confirmed">
            <TabsList>
              <TabsTrigger value="confirmed">
                確定（{data.confirmed.length}）
              </TabsTrigger>
              <TabsTrigger value="inProgress">
                進行中（{data.inProgress.length}）
              </TabsTrigger>
              <TabsTrigger value="past">終了（{data.past.length}）</TabsTrigger>
            </TabsList>
            <TabsContent value="confirmed" className="pt-4">
              <TicketList
                tickets={data.confirmed}
                empty="確定済みのチケットはありません。"
              />
            </TabsContent>
            <TabsContent value="inProgress" className="pt-4">
              <TicketList
                tickets={data.inProgress}
                empty="進行中の予約はありません。"
              />
            </TabsContent>
            <TabsContent value="past" className="pt-4">
              <TicketList
                tickets={data.past}
                empty="終了した予約はありません。"
              />
            </TabsContent>
          </Tabs>
          <AsOfNote asOf={data.asOf} />
        </>
      )}
    </div>
  );
}

function TicketList({ tickets, empty }: { tickets: Ticket[]; empty: string }) {
  if (tickets.length === 0) {
    return <p className="text-muted-foreground text-sm">{empty}</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {tickets.map((t) => (
        <TicketCard key={t.reservationId} ticket={t} />
      ))}
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const continueHref =
    ticket.status === "awaiting_payment"
      ? `/reservations/${ticket.reservationId}/checkout`
      : ticket.status === "authorized"
        ? `/reservations/${ticket.reservationId}/confirm`
        : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {ticket.seatIds.length} 席
          </CardTitle>
          <ReservationStatusBadge status={ticket.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {ticket.seatIds.map((s) => (
            <span
              key={s}
              className="rounded border bg-muted px-2 py-0.5 font-medium"
            >
              {s}
            </span>
          ))}
        </div>
        {ticket.totalAmount != null && ticket.currency != null && (
          <div className="text-muted-foreground">
            {formatMinorAmount(ticket.totalAmount, ticket.currency)}
          </div>
        )}
        {continueHref && (
          <Link
            href={continueHref}
            className={buttonVariants({ size: "sm", variant: "default" })}
          >
            手続きを続ける
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
