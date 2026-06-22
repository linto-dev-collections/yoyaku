import type { RateLimit } from "@cloudflare/workers-types";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Bindings } from "../types";

/**
 * レート制限（NFR-18）。Cloudflare ネイティブ Rate Limiting バインディング（`env.X.limit({key})`）で
 * 確保/決済/購入系の濫用を抑止する。キーは **userId（未ログインは接続 IP）×経路**＝NAT 配下の巻き込みを軽減。
 * 超過は 429（内部情報を漏らさない一般的文言）。zone 不要で workers.dev でも動作（dev=miniflare で検証可）。
 */
export const rateLimit = (pick: (env: Bindings) => RateLimit, bucket: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const key = `${bucket}:${rateLimitSubject(c)}`;
    const { success } = await pick(c.env).limit({ key });
    if (!success) {
      return c.json(
        {
          error: "rate_limited",
          message:
            "アクセスが集中しています。少し時間をおいて再試行してください。",
        },
        429,
      );
    }
    await next();
  });

/** レート制限のキー主体。ログイン済みは userId、未ログインは接続 IP（CF-Connecting-IP）。 */
function rateLimitSubject(c: Context<AppEnv>): string {
  const user = c.get("user");
  if (user) return `u:${user.id}`;
  return `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
}
