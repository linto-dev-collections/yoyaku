"use client";

import { Progress } from "@yoyaku/ui/components/ui/progress";
import { useEffect, useRef } from "react";
import { formatRemaining, remainingMs } from "@/lib/format";
import { useNow } from "@/lib/hooks";

// 確保 TTL（表示用の分母・サーバ既定 10 分）。残時間バーの満率算出にのみ使う。
const HOLD_TTL_MS = 10 * 60 * 1000;

/**
 * 確保カウントダウン（§3.2）。`holdExpiresAt`（epoch ms）から残時間を `progress`＋テキストで表示。
 * 0 で `onExpire` を一度だけ呼ぶ（空席へ戻す導線/再取得に使う）。
 */
export function HoldCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: number;
  onExpire?: () => void;
}) {
  const now = useNow(1000);
  const left = now === 0 ? null : remainingMs(expiresAt, now);
  const expired = left !== null && left <= 0;

  const fired = useRef(false);
  useEffect(() => {
    if (expired && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  const value = left !== null ? Math.min(100, (left / HOLD_TTL_MS) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">確保の残り時間</span>
        <span
          className={expired ? "font-medium text-destructive" : "font-medium"}
          aria-live="polite"
        >
          {left === null
            ? "—"
            : expired
              ? "確保時間切れ"
              : `残り ${formatRemaining(left)}`}
        </span>
      </div>
      <Progress value={value} />
    </div>
  );
}
