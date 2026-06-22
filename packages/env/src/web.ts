import { z } from "zod";

/** Next.js クライアントで使う公開環境変数（NEXT_PUBLIC_*）の検証。秘密は置かない（公開鍵のみ）。 */
const schema = z.object({
  NEXT_PUBLIC_SERVER_URL: z.url(),
  // Stripe 公開鍵（`pk_` プレフィックス検証・Phase 08 §3.3）。Secret/Connect は server のみ。
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .startsWith("pk_", "Stripe publishable key must start with pk_"),
  // Turnstile サイトキー（公開値・Phase 09・FR-17）。dev はテスト用 1x00000000000000000000AA。
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
});

export const env = schema.parse({
  NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
});
