import type Stripe from "stripe";

export type StripeConnectAccount = Stripe.Account | Stripe.V2.Core.Account;
type OnboardingStatus =
  | "pending"
  | "onboarding"
  | "active"
  | "restricted"
  | "disabled";

export type ConnectAccountState = {
  stripeConnectAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingStatus: OnboardingStatus;
  defaultCurrency: string | null;
};

function isV2Account(a: StripeConnectAccount): a is Stripe.V2.Core.Account {
  return a.object === "v2.core.account";
}

function onboardingStatusOfV1(a: Stripe.Account): OnboardingStatus {
  if (a.charges_enabled && a.payouts_enabled) return "active";
  if (a.requirements?.disabled_reason) return "disabled";
  if (a.details_submitted) return "restricted";
  return "onboarding";
}

function recipientCapabilitiesOf(a: Stripe.V2.Core.Account): {
  transferStatus: "active" | "pending" | "restricted" | "unsupported" | null;
  payoutStatus: "active" | "pending" | "restricted" | "unsupported" | null;
} {
  const balance = a.configuration?.recipient?.capabilities?.stripe_balance;
  return {
    transferStatus: balance?.stripe_transfers?.status ?? null,
    payoutStatus: balance?.payouts?.status ?? null,
  };
}

function onboardingStatusOfV2(a: Stripe.V2.Core.Account): OnboardingStatus {
  const { transferStatus, payoutStatus } = recipientCapabilitiesOf(a);
  if (transferStatus === "active" && payoutStatus === "active") {
    return "active";
  }
  if (transferStatus === "restricted" || payoutStatus === "restricted") {
    return "restricted";
  }
  if (transferStatus === "unsupported" || payoutStatus === "unsupported") {
    return "disabled";
  }
  if (transferStatus === "pending" || payoutStatus === "pending") {
    return "onboarding";
  }
  return "pending";
}

export function connectAccountStateOf(
  account: StripeConnectAccount,
): ConnectAccountState {
  const v2Capabilities = isV2Account(account)
    ? recipientCapabilitiesOf(account)
    : null;
  return {
    stripeConnectAccountId: account.id,
    chargesEnabled: isV2Account(account)
      ? v2Capabilities?.transferStatus === "active"
      : (account.charges_enabled ?? false),
    payoutsEnabled: isV2Account(account)
      ? v2Capabilities?.payoutStatus === "active"
      : (account.payouts_enabled ?? false),
    detailsSubmitted: isV2Account(account)
      ? v2Capabilities?.transferStatus === "active" &&
        v2Capabilities.payoutStatus === "active"
      : (account.details_submitted ?? false),
    onboardingStatus: isV2Account(account)
      ? onboardingStatusOfV2(account)
      : onboardingStatusOfV1(account),
    defaultCurrency: isV2Account(account)
      ? (account.defaults?.currency ?? null)
      : (account.default_currency ?? null),
  };
}
