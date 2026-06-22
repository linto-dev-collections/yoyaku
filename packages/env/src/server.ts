/// <reference path="../env.d.ts" />
import { env } from "cloudflare:workers";
import { z } from "zod";

/**
 * Worker ランタイムの環境変数を zod で検証（不足・不正があれば起動時に fail-fast）。
 * - バインディング（DB / SHOWING / RESERVATION / PROJECTION_QUEUE）は実行時オブジェクトのため
 *   スキーマ対象外。型は env.d.ts（typeof server.Env）が供給する。
 * - cloudflare:workers の env はトップレベルスコープで参照可能なので、モジュール読込時に検証する。
 */
const serverEnvSchema = z.object({
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SNAPSHOT_SECRET: z.string().min(1),
  STRIPE_WEBHOOK_THIN_SECRET: z.string().min(1),
  STRIPE_CONNECT_COUNTRY: z
    .string()
    .length(2)
    .transform((v) => v.toUpperCase()),
  CORS_ORIGIN: z.url(),
  // 公平性/不正対策（Phase 09・FR-17）。Turnstile siteverify の秘密鍵。
  // dev は Cloudflare のテスト用 secret（1x0000000000000000000000000000000AA）で常に成功。
  TURNSTILE_SECRET_KEY: z.string().min(1),
  // 運用/管理エンドポイントのプラットフォーム管理トークン（Phase 10・NFR-17）。
  // 再投影・as-of・照合手動実行・メトリクスを X-Admin-Token ヘッダで認可。組織横断の運用ロール。
  ADMIN_API_TOKEN: z.string().min(1),
});

// env が実バインディングのオブジェクトになるのは Workers ランタイムだけ。
// Node 上のツール（better-auth CLI の jiti 経由 codegen 等）がこのモジュールを
// import する際は env がスタブ（関数）になり parse が誤検知するため、
// オブジェクトのとき（＝Workers 実行時）のみ検証する。
if (typeof env === "object" && env !== null) {
  serverEnvSchema.parse(env);
}

export { env };
