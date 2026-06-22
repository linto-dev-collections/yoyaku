import { db } from "@yoyaku/db";
import * as schema from "@yoyaku/db/schema";
import { env } from "@yoyaku/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";
import { ac, admin, member, owner } from "./permissions";

/**
 * Better Auth（Cloudflare Workers + D1）。
 * - 認証は Google サインインのみ（email/password・passkey・2FA・magic link は不採用）。
 * - 主催は Organization プラグイン（マルチテナント・RBAC）。
 * - テーブル名は usePlural:true で一括複数形化（コア＋プラグイン全モデルに +s。@yoyaku/db のスキーマと一致）。
 *   ※ modelName と併用すると二重に s が付くため、modelName は使わない。
 * - 単一 workers.dev オリジン前提のため same-site cookie（custom domain 不使用）。
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.CORS_ORIGIN],
  database: drizzleAdapter(db, { provider: "sqlite", schema, usePlural: true }),
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  plugins: [
    organization({
      ac,
      roles: { owner, admin, member },
    }),
  ],
  databaseHooks: {
    session: {
      create: {
        /**
         * セッション作成時に activeOrganizationId を補完（既定: 明示作成のみ）。
         * 個人組織の自動作成は行わない（主催は明示的に組織を作成）。所属が無いユーザーは
         * activeOrganizationId 未設定のまま（一般購入者）。未設定時のみ最古の所属組織を設定。
         */
        before: async (session) => {
          if (session.activeOrganizationId) return;
          const membership = await db
            .select({ organizationId: schema.members.organizationId })
            .from(schema.members)
            .where(eq(schema.members.userId, session.userId))
            .orderBy(asc(schema.members.createdAt))
            .limit(1)
            .get();
          if (!membership) return;
          return {
            data: {
              ...session,
              activeOrganizationId: membership.organizationId,
            },
          };
        },
      },
    },
  },
});

export type Auth = typeof auth;
