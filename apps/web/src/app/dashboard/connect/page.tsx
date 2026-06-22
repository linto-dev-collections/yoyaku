"use client";

import { Alert, AlertDescription } from "@yoyaku/ui/components/ui/alert";
import { Badge } from "@yoyaku/ui/components/ui/badge";
import { Button } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { toast } from "@yoyaku/ui/components/ui/sonner";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { errorMessageFrom } from "@/lib/http";
import { useActiveOrg } from "@/lib/use-active-org";

type ConnectStatus = {
  connected: boolean;
  stripeConnectAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingStatus:
    | "pending"
    | "onboarding"
    | "active"
    | "restricted"
    | "disabled";
  defaultCurrency: string | null;
};

const STATUS_LABEL: Record<ConnectStatus["onboardingStatus"], string> = {
  pending: "未設定",
  onboarding: "確認中",
  active: "完了",
  restricted: "要対応",
  disabled: "無効",
};

export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectInner />
    </Suspense>
  );
}

function ConnectInner() {
  const { orgId, isPending } = useActiveOrg();
  const status = useSearchParams().get("status");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connect, setConnect] = useState<ConnectStatus | null>(null);

  useEffect(() => {
    if (!orgId) {
      setConnect(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api.organizations[":id"].connect.status
      .$get({ param: { id: orgId } })
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) {
          toast.error(await errorMessageFrom(res));
          return;
        }
        setConnect(await res.json());
      })
      .catch(() => {
        if (alive) toast.error("Stripe Connect の状態を取得できませんでした。");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [orgId]);

  async function start() {
    if (!orgId) {
      toast.error("有効な組織がありません。先に組織を作成・選択してください。");
      return;
    }
    setBusy(true);
    const res = await api.organizations[":id"].connect.onboarding.$post({
      param: { id: orgId },
    });
    if (!res.ok) {
      toast.error(await errorMessageFrom(res));
      setBusy(false);
      return;
    }
    const { url } = await res.json();
    // Stripe のオンボーディング（Account Link）へ遷移。完了後は return_url で戻る。
    window.location.href = url;
  }

  const ready = connect?.onboardingStatus === "active";
  const statusLabel = connect
    ? STATUS_LABEL[connect.onboardingStatus]
    : isPending || loading
      ? "取得中"
      : "未設定";

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="font-bold text-2xl tracking-tight">Stripe Connect</h1>

      {status === "return" && ready && (
        <Alert>
          <AlertDescription>
            Stripe Connect の設定が完了しています。公演を公開できます。
          </AlertDescription>
        </Alert>
      )}
      {status === "return" && !ready && (
        <Alert>
          <AlertDescription>
            Stripe から戻りました。審査状況の反映には数分かかることがあります。
            状態が変わらない場合はオンボーディングを続けてください。
          </AlertDescription>
        </Alert>
      )}
      {status === "refresh" && (
        <Alert variant="destructive">
          <AlertDescription>
            オンボーディングのリンクが期限切れになりました。もう一度開始してください。
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>受け取り口座の設定</CardTitle>
            <Badge variant={ready ? "default" : "secondary"}>
              {statusLabel}
            </Badge>
          </div>
          <CardDescription>
            {ready
              ? "本人確認・口座登録は完了しています。売上の受け取りと公演公開が可能です。"
              : "売上を受け取るために Stripe の本人確認・口座登録を完了してください。owner のみ実施できます。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connect?.connected && (
            <div className="grid gap-2 text-sm">
              <StatusRow label="送金受領" value={connect.chargesEnabled} />
              <StatusRow label="銀行出金" value={connect.payoutsEnabled} />
              <StatusRow label="本人確認" value={connect.detailsSubmitted} />
              {connect.defaultCurrency && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">通貨</span>
                  <span className="font-medium uppercase">
                    {connect.defaultCurrency}
                  </span>
                </div>
              )}
            </div>
          )}
          <Button onClick={start} disabled={busy}>
            {busy
              ? "リンクを準備中…"
              : ready
                ? "設定を確認/更新"
                : "オンボーディングを開始/続ける"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={value ? "default" : "secondary"}>
        {value ? "有効" : "未完了"}
      </Badge>
    </div>
  );
}
