"use client";

import { env } from "@yoyaku/env/web";
import { useEffect, useRef } from "react";

// Cloudflare Turnstile の明示レンダリング API（window.turnstile）。global interface 拡張は使わず型で受ける。
type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const getTurnstile = (): TurnstileApi | undefined =>
  (window as unknown as { turnstile?: TurnstileApi }).turnstile;

/**
 * Turnstile ウィジェット（FR-17・§4）。高リスク公演でのみ表示し、検証トークンを親へ渡す。
 * トークンは確保/決済リクエストの `cf-turnstile-response` ヘッダで送る（サーバが siteverify）。
 * `onToken` は useCallback で安定化して渡すこと（再レンダリングでの再生成を防ぐ）。
 */
export function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | undefined;

    const render = () => {
      const ts = getTurnstile();
      if (cancelled || !ref.current || !ts) return;
      widgetId = ts.render(ref.current, {
        sitekey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        callback: (token) => onToken(token),
        "error-callback": () => onToken(null),
        "expired-callback": () => onToken(null),
      });
    };

    if (getTurnstile()) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SCRIPT_SRC}"]`,
      );
      if (existing) {
        existing.addEventListener("load", render);
      } else {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.addEventListener("load", render);
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      const ts = getTurnstile();
      if (widgetId && ts) ts.remove(widgetId);
    };
  }, [onToken]);

  return <div ref={ref} className="min-h-[65px]" />;
}
