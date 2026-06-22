"use client";

import { useEffect, useState } from "react";

/**
 * 一定間隔で現在時刻（epoch ms）を更新するフック。hold 失効カウントダウン等の再描画に使う。
 * 初期値は 0（SSR とクライアント初回描画を一致させてハイドレーション差異を避ける）。
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
