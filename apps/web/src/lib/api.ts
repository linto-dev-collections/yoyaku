import { env } from "@yoyaku/env/web";
import { hcWithType } from "@yoyaku/server/hc";

/**
 * 型付き RPC クライアント（Hono RPC）。型は `@yoyaku/server/hc`（ビルド済み `AppType`）から推論し、
 * 手書きの型定義は持たない。`./hc` は dist 境界（web は server の src を参照しない・depcruise）。
 * Cookie セッションを送るため `credentials:"include"`、読みは常に最新を取るため `cache:"no-store"`。
 */
export const api = hcWithType(env.NEXT_PUBLIC_SERVER_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { credentials: "include", cache: "no-store", ...init }),
});
