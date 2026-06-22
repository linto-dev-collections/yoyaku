"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { env } from "@yoyaku/env/web";
import { Button } from "@yoyaku/ui/components/ui/button";
import { toast } from "@yoyaku/ui/components/ui/sonner";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

// 公開鍵でクライアント Stripe を初期化（モジュール一度きり）。秘密鍵は server のみ。
const stripePromise = loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

/**
 * Stripe Elements 決済（オーソリ・§3.3）。manual capture の PaymentIntent を `clientSecret` で確認する。
 * SCA/3DS は `confirmPayment` が処理（`redirect:"if_required"`）。成功＝`requires_capture`→最終確定ページへ。
 */
export function StripeCheckout({
  clientSecret,
  reservationId,
}: {
  clientSecret: string;
  reservationId: string;
}) {
  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance: { theme: "stripe" } }}
    >
      <PaymentForm reservationId={reservationId} clientSecret={clientSecret} />
    </Elements>
  );
}

function PaymentForm({
  reservationId,
  clientSecret,
}: {
  reservationId: string;
  clientSecret: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      toast.error(submitError.message ?? "支払い情報を確認してください。");
      setSubmitting(false);
      return;
    }

    try {
      // 3DS リダイレクト型に備え return_url を指定（戻り先＝最終確定ページで状態確認）。
      const returnUrl = `${window.location.origin}/reservations/${reservationId}/confirm`;
      const { error } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (error) {
        toast.error(error.message ?? "決済の確認に失敗しました。");
        setSubmitting(false);
        return;
      }
      // manual capture のため、確認成功で PaymentIntent は requires_capture。最終確定（キャプチャ）へ。
      router.push(`/reservations/${reservationId}/confirm`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "決済の確認に失敗しました。";
      toast.error(message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement />
      <Button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full"
        size="lg"
      >
        {submitting ? "処理中…" : "カードを確認して与信を確保"}
      </Button>
      <p className="text-muted-foreground text-xs">
        この段階では与信枠を確保（オーソリ）するだけで、まだ請求は確定しません。次の画面で最終確定します。
      </p>
    </form>
  );
}
