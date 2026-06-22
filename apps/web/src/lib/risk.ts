/**
 * リスク区分の Web 側ミラー（web→domain 依存は張らないため最小限を再定義・read model の riskTier を受ける）。
 * 必須対策の正本はサーバ（ドメインの riskControls）。ここでは UI 提示用の判定のみ。
 */
export function isHighRisk(tier: string | null | undefined): boolean {
  return tier === "high_risk";
}

/** 区分の表示ラベル（general は表示しない＝null）。 */
export function riskTierLabel(tier: string | null | undefined): string | null {
  switch (tier) {
    case "popular":
      return "人気公演";
    case "high_risk":
      return "高需要公演";
    default:
      return null;
  }
}
