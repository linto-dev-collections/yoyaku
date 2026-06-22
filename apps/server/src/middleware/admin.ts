import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

/** 長さ非依存の定数時間比較（タイミング攻撃を避ける）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * 運用/管理エンドポイントの認可（Phase 10・NFR-17）。プラットフォーム管理トークンを
 * `X-Admin-Token` ヘッダで受け、`env.ADMIN_API_TOKEN` と定数時間比較する。組織横断の運用ロール
 * （再投影・as-of・照合手動実行・メトリクス）。不一致/未設定は 401（内部情報を漏らさない）。
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header("x-admin-token");
  const expected = c.env.ADMIN_API_TOKEN;
  if (!expected || !token || !timingSafeEqual(token, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
