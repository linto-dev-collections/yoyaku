import { auth } from "@yoyaku/auth";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

/**
 * セッション抽出ミドルウェア（全体適用）。
 * Cookie/Bearer から Better Auth セッションを解決し、user/session/activeOrganizationId を Variables に載せる。
 * 認可（拒否）は行わない＝未ログインでも next（公開照会のため）。拒否は requireAuth / requireOrgRole が担う。
 */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
    c.set("activeOrganizationId", session.session.activeOrganizationId ?? null);
  } else {
    c.set("user", undefined);
    c.set("session", undefined);
    c.set("activeOrganizationId", null);
  }
  await next();
});

/** ログイン必須（FR-30: ゲスト購入不可）。sessionMiddleware の後段で使う。 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
  await next();
});
