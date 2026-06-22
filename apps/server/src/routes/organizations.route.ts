import { DomainError } from "@yoyaku/domain";
import { Hono } from "hono";
import type Stripe from "stripe";
import { createStripe } from "../infrastructure/stripe/client";
import { getConnectAccount, upsertConnectAccount } from "../lib/connect";
import { requireOrgRole } from "../middleware/rbac";
import type { AppEnv } from "../types";

function toConnectSetupError(error: unknown): DomainError {
  const message =
    error instanceof Error ? error.message : "Stripe Connect setup failed";
  return new DomainError("stripe_connect_setup_required", 409, message);
}

function isStripeInvalidRequest(
  error: unknown,
): error is { type: "StripeInvalidRequestError" } {
  return (
    error !== null &&
    typeof error === "object" &&
    "type" in error &&
    (error as { type?: unknown }).type === "StripeInvalidRequestError"
  );
}

const ACCOUNT_INCLUDE: Stripe.V2.Core.AccountCreateParams.Include[] = [
  "configuration.recipient",
  "defaults",
  "identity",
  "requirements",
];

function recipientConfiguration(
  country: string,
): Pick<
  Stripe.V2.Core.AccountCreateParams,
  "configuration" | "dashboard" | "defaults" | "identity"
> {
  return {
    dashboard: "express",
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    identity: { country: country.toLowerCase() },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
  };
}

function hasRecipientConfiguration(account: Stripe.V2.Core.Account): boolean {
  return account.applied_configurations.includes("recipient");
}

async function retrieveV2Account(
  stripe: Stripe,
  accountId: string,
): Promise<Stripe.V2.Core.Account | null> {
  try {
    return await stripe.v2.core.accounts.retrieve(accountId, {
      include: ACCOUNT_INCLUDE,
    });
  } catch (e) {
    if (isStripeInvalidRequest(e)) return null;
    throw e;
  }
}

async function createRecipientAccount(
  stripe: Stripe,
  organizationId: string,
  contactEmail: string,
  country: string,
): Promise<Stripe.V2.Core.Account> {
  return stripe.v2.core.accounts.create(
    {
      ...recipientConfiguration(country),
      contact_email: contactEmail,
      include: ACCOUNT_INCLUDE,
      metadata: { organizationId },
    },
    { idempotencyKey: `connect-account-v4-recipient:${organizationId}` },
  );
}

async function ensureRecipientAccount(
  stripe: Stripe,
  accountId: string,
  organizationId: string,
  contactEmail: string,
  country: string,
): Promise<Stripe.V2.Core.Account | null> {
  const account = await retrieveV2Account(stripe, accountId);
  if (!account) return null;
  if (hasRecipientConfiguration(account)) return account;

  return stripe.v2.core.accounts.update(
    account.id,
    {
      ...recipientConfiguration(country),
      contact_email: contactEmail,
      include: ACCOUNT_INCLUDE,
      metadata: { organizationId },
    },
    { idempotencyKey: `connect-account-v2-apply-recipient:${account.id}` },
  );
}

/**
 * 主催（組織）。Stripe Connect オンボーディング（§2）。
 * 公演を販売可能にする前提＝Accounts v2 recipient `stripe_balance.stripe_transfers` が active。owner のみ実施。
 */
export const organizationsRoute = new Hono<AppEnv>()
  .get(
    "/:id/connect/status",
    requireOrgRole("admin", (c) => c.req.param("id") ?? null),
    async (c) => {
      const organizationId = c.req.param("id");
      const existing = await getConnectAccount(organizationId);
      if (!existing) {
        return c.json({
          connected: false,
          stripeConnectAccountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          onboardingStatus: "pending" as const,
          defaultCurrency: null,
        });
      }

      const stripe = createStripe(c.env.STRIPE_SECRET_KEY);
      const account = await retrieveV2Account(
        stripe,
        existing.stripeConnectAccountId,
      );
      if (account) {
        await upsertConnectAccount(organizationId, account);
        const refreshed = await getConnectAccount(organizationId);
        if (refreshed) {
          return c.json({ connected: true, ...refreshed });
        }
      }

      return c.json({ connected: true, ...existing });
    },
  )
  .post(
    "/:id/connect/onboarding",
    requireOrgRole("owner", (c) => c.req.param("id") ?? null),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);

      const organizationId = c.req.param("id");
      const stripe = createStripe(c.env.STRIPE_SECRET_KEY);
      const country = c.env.STRIPE_CONNECT_COUNTRY;

      // Accounts v2 の recipient account を作成/利用する。
      // 本システムは `on_behalf_of` なしの destination charge なので、主催は merchant of record ではなく
      // platform balance から transfer を受け取る recipient としてオンボーディングする。
      // 旧実装で作られた v1/non-recipient account は v2/core/account_links に使えないため再利用しない。
      const existing = await getConnectAccount(organizationId);
      let account: Stripe.V2.Core.Account | null = null;
      try {
        if (existing?.stripeConnectAccountId) {
          const candidate = await ensureRecipientAccount(
            stripe,
            existing.stripeConnectAccountId,
            organizationId,
            user.email,
            country,
          );
          account =
            candidate && hasRecipientConfiguration(candidate)
              ? candidate
              : null;
        }
        account ??= await createRecipientAccount(
          stripe,
          organizationId,
          user.email,
          country,
        );
      } catch (e) {
        if (isStripeInvalidRequest(e)) throw toConnectSetupError(e);
        throw e;
      }
      if (!hasRecipientConfiguration(account)) {
        throw new DomainError(
          "stripe_connect_setup_required",
          409,
          "Stripe Accounts v2 recipient configuration was not applied",
        );
      }
      const accountId = account.id;
      await upsertConnectAccount(organizationId, account);

      // 主催が完了させる Account Link（return/refresh 先は Web。ダッシュボードは Phase 08）。
      const base = c.env.CORS_ORIGIN;
      let link: Stripe.V2.Core.AccountLink;
      try {
        link = await stripe.v2.core.accountLinks.create({
          account: accountId,
          use_case: {
            type: "account_onboarding",
            account_onboarding: {
              configurations: ["recipient"],
              refresh_url: `${base}/dashboard/connect?org=${organizationId}&status=refresh`,
              return_url: `${base}/dashboard/connect?org=${organizationId}&status=return`,
            },
          },
        });
      } catch (e) {
        if (isStripeInvalidRequest(e)) throw toConnectSetupError(e);
        throw e;
      }
      return c.json({ url: link.url, connectAccountId: accountId });
    },
  );
