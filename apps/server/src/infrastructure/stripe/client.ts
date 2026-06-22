import Stripe from "stripe";

/** API バージョン pin（インストール済み SDK の LatestApiVersion と一致＝型安全）。 */
export const STRIPE_API_VERSION = "2026-05-27.dahlia";

/**
 * Accounts v2（Connect v2: `v2/core/accounts`・`account_links`）は **preview API**。
 * GA 版（dahlia）で呼ぶと「specify the latest .preview Stripe-Version」で拒否されるため、
 * v2 呼び出し用に preview 版 Stripe-Version を送る別クライアントを使う（createStripeV2）。
 * 日付は SDK の生成 spec 日（2026-05-27）に揃え、SDK が期待する v2 型と request/response 形を一致させる。
 * 型は string（コンストラクタの apiVersion は LatestApiVersion 固定のため cast する）。
 */
export const STRIPE_V2_PREVIEW_VERSION: string = "2026-05-27.preview";

let cached: { key: string; client: Stripe } | null = null;
let cachedV2: { key: string; client: Stripe } | null = null;

/**
 * Cloudflare Workers 用 Stripe クライアント（fetch http client・API 版 pin）。
 * `env.STRIPE_SECRET_KEY` を渡す。同一 isolate・同一キーはキャッシュして再利用する。
 * v1（PaymentIntent / Customer / webhook 署名検証）はこちらを使う（GA 版で安定）。
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

/**
 * Accounts v2（Connect v2）preview API 用クライアント。preview 版 Stripe-Version を送る。
 * `v2.core.accounts.*` / `v2.core.accountLinks.*` の呼び出しに使う。
 * v1 の挙動には影響しない（v1 呼び出しは createStripe を使い続ける）。
 */
export function createStripeV2(secretKey: string): Stripe {
  if (cachedV2 && cachedV2.key === secretKey) return cachedV2.client;
  const client = new Stripe(secretKey, {
    // コンストラクタの apiVersion は LatestApiVersion 固定型。runtime はこの文字列をそのまま
    // Stripe-Version ヘッダに送るため、フィールドが受け付ける型へ cast する（値は preview のまま）。
    apiVersion: STRIPE_V2_PREVIEW_VERSION as typeof STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
  cachedV2 = { key: secretKey, client };
  return client;
}
