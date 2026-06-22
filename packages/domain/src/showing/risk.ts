/**
 * 公演の負荷/リスク区分（NFR-15）と、区分から必須化される公平性/不正対策の導出（純粋）。
 * サーバ（Turnstile 必須判定）とドメイン（上限既定）で共有する。Web は read model の `riskTier` を受けて
 * 自前のミラーで提示する（web→domain 依存は張らない）。
 */
export type RiskTier = "general" | "popular" | "high_risk";

export const RISK_TIERS = ["general", "popular", "high_risk"] as const;

/** 1 ユーザー 1 公演あたりの購入上限の既定（席数・FR-15/BR-05）。全公演に既定で適用。 */
export const DEFAULT_MAX_SEATS_PER_USER = 4;

/** 区分が必須化する対策（true=その区分で必須）。レート制限は区分非依存で全経路に適用するため含めない。 */
export type RiskControls = {
  /** 購入上限を区分として必須化（popular 以上）。既定 4 席は全区分に適用される。 */
  purchaseLimit: boolean;
  /** Turnstile（siteverify）を確保/決済前に必須化（high_risk）。 */
  turnstile: boolean;
  /** Waiting Room（エッジ整流）を販売ルートに必須化（high_risk）。 */
  waitingRoom: boolean;
};

/** 区分 → 必須対策（計画 §1 の表）。general は既定レート制限のみ。 */
export function riskControls(tier: RiskTier): RiskControls {
  switch (tier) {
    case "general":
      return { purchaseLimit: false, turnstile: false, waitingRoom: false };
    case "popular":
      return { purchaseLimit: true, turnstile: false, waitingRoom: false };
    case "high_risk":
      return { purchaseLimit: true, turnstile: true, waitingRoom: true };
    default:
      tier satisfies never;
      return { purchaseLimit: false, turnstile: false, waitingRoom: false };
  }
}

/** 任意の文字列を RiskTier に正規化（未知/未指定は "general"）。登録入力の防御に使う。 */
export function asRiskTier(value: unknown): RiskTier {
  return value === "popular" || value === "high_risk" ? value : "general";
}
