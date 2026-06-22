import { db } from "@yoyaku/db";
import { userPaymentProfiles } from "@yoyaku/db/schema";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

/**
 * ユーザーの Stripe Customer を取得 or 作成（初回 authorize 時・§3.1）。
 * 同時実行で稀に Customer が二重作成されうるが onConflictDoNothing＋再読込で 1 つに収束する
 * （余剰 Customer は無害＝課金なし）。
 */
export async function getOrCreateCustomer(
  stripe: Stripe,
  user: { id: string; email: string; name?: string | null },
): Promise<string> {
  const found = await readCustomerId(user.id);
  if (found) return found;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });
  await db
    .insert(userPaymentProfiles)
    .values({ userId: user.id, stripeCustomerId: customer.id })
    .onConflictDoNothing({ target: userPaymentProfiles.userId });

  // 競合で別リクエストが先に書いた場合はそちらを採用。
  return (await readCustomerId(user.id)) ?? customer.id;
}

async function readCustomerId(userId: string): Promise<string | null> {
  const row = await db
    .select({ stripeCustomerId: userPaymentProfiles.stripeCustomerId })
    .from(userPaymentProfiles)
    .where(eq(userPaymentProfiles.userId, userId))
    .get();
  return row?.stripeCustomerId ?? null;
}
