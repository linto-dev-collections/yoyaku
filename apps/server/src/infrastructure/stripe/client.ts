import Stripe from "stripe";

/** API バージョン pin（インストール済み SDK の LatestApiVersion と一致＝型安全）。 */
export const STRIPE_API_VERSION = "2026-05-27.dahlia";

let cached: { key: string; client: Stripe } | null = null;

/**
 * Cloudflare Workers 用 Stripe クライアント（fetch http client・API 版 pin）。
 * `env.STRIPE_SECRET_KEY` を渡す。同一 isolate・同一キーはキャッシュして再利用する。
 */
export function createStripe(secretKey: string): Stripe {
  if (cached && cached.key === secretKey) return cached.client;
  const client = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
  cached = { key: secretKey, client };
  return client;
}
