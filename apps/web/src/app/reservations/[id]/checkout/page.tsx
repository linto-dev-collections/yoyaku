"use client";

import { Alert, AlertDescription } from "@yoyaku/ui/components/ui/alert";
import { buttonVariants } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Separator } from "@yoyaku/ui/components/ui/separator";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HoldCountdown } from "@/components/hold-countdown";
import { ReservationSteps } from "@/components/reservation-steps";
import { StripeCheckout } from "@/components/stripe-checkout";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { api } from "@/lib/api";
import type { ReservationView } from "@/lib/api-types";
import { formatMinorAmount } from "@/lib/format";
import { errorMessageFrom } from "@/lib/http";
import { isHighRisk } from "@/lib/risk";

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<ReservationView | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [needsTurnstile, setNeedsTurnstile] = useState(false);

  // オーソリ用 PaymentIntent を作成し clientSecret を取得（confirm はクライアント）。
  // 高リスク公演はトークンを送る（サーバが siteverify・FR-17）。
  const authorize = useCallback(
    async (token?: string) => {
      const auth = await api.reservations[":id"].authorize.$post(
        { param: { id } },
        token ? { headers: { "cf-turnstile-response": token } } : undefined,
      );
      if (!auth.ok) {
        setError(await errorMessageFrom(auth));
        return;
      }
      const { clientSecret: cs } = await auth.json();
      setClientSecret(cs);
    },
    [id],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await api.reservations[":id"].$get({ param: { id } });
      if (!res.ok) {
        if (active) setError(await errorMessageFrom(res));
        return;
      }
      const v = await res.json();
      if (!active) return;
      setView(v);
      if (v.status === "authorized" || v.status === "confirmed") {
        router.replace(`/reservations/${id}/confirm`);
        return;
      }
      if (v.status !== "awaiting_payment") {
        setError("この予約は決済できる状態ではありません。");
        return;
      }
      // 高リスク公演は決済前に Turnstile を要求（widget 完了で authorize）。それ以外は即オーソリ。
      const showings = await api.showings.$get({ query: {} });
      const tier = showings.ok
        ? (await showings.json()).showings.find(
            (s) => s.showingId === v.showingId,
          )?.riskTier
        : undefined;
      if (active && isHighRisk(tier)) setNeedsTurnstile(true);
      else if (active) await authorize();
    })();
    return () => {
      active = false;
    };
  }, [id, router, authorize]);

  const onTurnstile = useCallback(
    (token: string | null) => {
      if (token) {
        setNeedsTurnstile(false);
        authorize(token);
      }
    },
    [authorize],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ReservationSteps current="pay" />
      <h1 className="font-bold text-2xl tracking-tight">決済</h1>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            <Link href="/me/tickets" className={buttonVariants({ size: "sm" })}>
              マイチケットへ
            </Link>
          </AlertDescription>
        </Alert>
      ) : view === null ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="space-y-6">
          {view.holdExpiresAt != null && (
            <HoldCountdown
              expiresAt={view.holdExpiresAt}
              onExpire={() => setExpired(true)}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>ご注文内容</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-1.5">
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
                <>
                  <Separator className="my-2" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      小計（{view.pricing.quantity} 席）
                    </span>
                    <span>
                      {formatMinorAmount(
                        view.pricing.subtotalAmount,
                        view.pricing.currency,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>合計</span>
                    <span>
                      {formatMinorAmount(
                        view.pricing.totalAmount,
                        view.pricing.currency,
                      )}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {expired ? (
            <Alert variant="destructive">
              <AlertDescription className="space-y-2">
                <p>
                  確保時間が切れました。お手数ですが席を選び直してください。
                </p>
                <Link
                  href={`/showings/${view.showingId}/reserve`}
                  className={buttonVariants({ size: "sm" })}
                >
                  席を選び直す
                </Link>
              </AlertDescription>
            </Alert>
          ) : needsTurnstile ? (
            <Card>
              <CardHeader>
                <CardTitle>混雑対策の確認</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  人気公演のため、決済の前に確認（Turnstile）が必要です。
                </p>
                <TurnstileWidget onToken={onTurnstile} />
              </CardContent>
            </Card>
          ) : clientSecret ? (
            <Card>
              <CardHeader>
                <CardTitle>お支払い</CardTitle>
              </CardHeader>
              <CardContent>
                <StripeCheckout
                  clientSecret={clientSecret}
                  reservationId={id}
                />
              </CardContent>
            </Card>
          ) : (
            <Skeleton className="h-40" />
          )}
        </div>
      )}
    </div>
  );
}
