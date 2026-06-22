import { db } from "@yoyaku/db";
import { organizationConnectAccounts } from "@yoyaku/db/schema";
import { eq } from "drizzle-orm";
import {
  connectAccountStateOf,
  type StripeConnectAccount,
} from "./connect-state";

export type ConnectAccount = {
  stripeConnectAccountId: string;
  /** v2 recipient `stripe_balance.stripe_transfers` が active。既存カラム名は後方互換で維持する。 */
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingStatus:
    | "pending"
    | "onboarding"
    | "active"
    | "restricted"
    | "disabled";
  defaultCurrency: string | null;
};

/** 組織の Connect アカウント（無ければ null）。公開ガード・authorize の前提確認に使う。 */
export async function getConnectAccount(
  organizationId: string,
): Promise<ConnectAccount | null> {
  const row = await db
    .select({
      stripeConnectAccountId:
        organizationConnectAccounts.stripeConnectAccountId,
      chargesEnabled: organizationConnectAccounts.chargesEnabled,
      payoutsEnabled: organizationConnectAccounts.payoutsEnabled,
      detailsSubmitted: organizationConnectAccounts.detailsSubmitted,
      onboardingStatus: organizationConnectAccounts.onboardingStatus,
      defaultCurrency: organizationConnectAccounts.defaultCurrency,
    })
    .from(organizationConnectAccounts)
    .where(eq(organizationConnectAccounts.organizationId, organizationId))
    .get();
  return row ?? null;
}

/** Stripe Account の最新状態を organization_connect_accounts に upsert（オンボーディング/同期）。 */
export async function upsertConnectAccount(
  organizationId: string,
  account: StripeConnectAccount,
): Promise<void> {
  const set = connectAccountStateOf(account);
  await db
    .insert(organizationConnectAccounts)
    .values({ organizationId, ...set })
    .onConflictDoUpdate({
      target: organizationConnectAccounts.organizationId,
      set,
    });
}

/**
 * Stripe webhook の同期。account.id から組織を逆引きして状態を反映。
 * 既知の Connect アカウントでなければ false（スキップ）。
 */
export async function syncConnectAccount(
  account: StripeConnectAccount,
): Promise<boolean> {
  const row = await db
    .select({ organizationId: organizationConnectAccounts.organizationId })
    .from(organizationConnectAccounts)
    .where(eq(organizationConnectAccounts.stripeConnectAccountId, account.id))
    .get();
  if (!row) return false;
  await upsertConnectAccount(row.organizationId, account);
  return true;
}
