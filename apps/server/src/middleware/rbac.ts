import { db } from "@yoyaku/db";
import { members } from "@yoyaku/db/schema";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { hasRole, type OrgRole } from "./roles";

/**
 * 対象組織の解決方法（path/body/query から、または対象公演の organizationId から引く）。
 * Phase 04 のコマンドルートは公演 read model から org を引く resolver を渡す。
 */
export type OrgIdResolver = (
  c: Context<AppEnv>,
) => Promise<string | null> | string | null;

/** 既定: `?organizationId=` または JSON body の organizationId を使う。 */
const defaultResolveOrgId: OrgIdResolver = async (c) => {
  const fromQuery = c.req.query("organizationId");
  if (fromQuery) return fromQuery;
  if ((c.req.header("content-type") ?? "").includes("application/json")) {
    const body = (await c.req.json().catch(() => null)) as {
      organizationId?: unknown;
    } | null;
    if (body && typeof body.organizationId === "string") {
      return body.organizationId;
    }
  }
  return null;
};

/**
 * 組織スコープ操作の RBAC（BR-12/FR-32）。要求ロール `min` 以上のメンバーのみ許可。
 * ロールは read model（投影）ではなく認証テーブル `members` を直接参照（強整合・同期書き込み）。
 * 401: 未ログイン / 400: 組織未解決 / 403: 権限不足。成立時は activeOrganizationId を確定。
 */
export const requireOrgRole = (
  min: OrgRole,
  resolveOrgId: OrgIdResolver = defaultResolveOrgId,
) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const orgId = await resolveOrgId(c);
    if (!orgId) return c.json({ error: "organization_required" }, 400);

    const role = await getMemberRole(user.id, orgId);
    if (!hasRole(role, min)) return c.json({ error: "forbidden" }, 403);

    c.set("activeOrganizationId", orgId);
    await next();
  });

/** (userId, organizationId) のメンバーロールを認証テーブルから取得。未所属は null。 */
export async function getMemberRole(
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const row = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.userId, userId),
        eq(members.organizationId, organizationId),
      ),
    )
    .get();
  return row?.role ?? null;
}
