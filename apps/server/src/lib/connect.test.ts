import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { connectAccountStateOf } from "./connect-state";

describe("connectAccountStateOf", () => {
  it("maps Accounts v2 recipient transfer capability to payment readiness", () => {
    const account = {
      id: "acct_v2",
      object: "v2.core.account",
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { status: "active", status_details: [] },
              payouts: { status: "pending", status_details: [] },
            },
          },
        },
      },
      defaults: { currency: "jpy" },
    } as unknown as Stripe.V2.Core.Account;

    expect(connectAccountStateOf(account)).toMatchObject({
      stripeConnectAccountId: "acct_v2",
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: false,
      onboardingStatus: "onboarding",
      defaultCurrency: "jpy",
    });
  });

  it("marks Accounts v2 recipient onboarding active when transfers and payouts are active", () => {
    const account = {
      id: "acct_v2_ready",
      object: "v2.core.account",
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { status: "active", status_details: [] },
              payouts: { status: "active", status_details: [] },
            },
          },
        },
      },
      defaults: { currency: "jpy" },
    } as unknown as Stripe.V2.Core.Account;

    expect(connectAccountStateOf(account)).toMatchObject({
      stripeConnectAccountId: "acct_v2_ready",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: "active",
      defaultCurrency: "jpy",
    });
  });

  it("treats restricted Accounts v2 recipient transfer capability as not ready", () => {
    const account = {
      id: "acct_restricted",
      object: "v2.core.account",
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { status: "restricted", status_details: [] },
            },
          },
        },
      },
    } as unknown as Stripe.V2.Core.Account;

    expect(connectAccountStateOf(account)).toMatchObject({
      chargesEnabled: false,
      detailsSubmitted: false,
      onboardingStatus: "restricted",
    });
  });

  it("keeps Accounts v1 fallback semantics for existing connected accounts", () => {
    const account = {
      id: "acct_v1",
      object: "account",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      default_currency: "jpy",
    } as unknown as Stripe.Account;

    expect(connectAccountStateOf(account)).toMatchObject({
      stripeConnectAccountId: "acct_v1",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: "active",
      defaultCurrency: "jpy",
    });
  });
});
