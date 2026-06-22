/**
 * Cloudflare Turnstile のサーバ側検証（FR-17・siteverify）。クライアントの widget だけでは
 * 直接 POST を防げないため、**確保/決済前にサーバで必ず検証**する（トークンは一度のみ有効）。
 * 高リスク公演でのみ必須化し、検証不能は **フェイルクローズ**（403 相当＝通さない）。
 */
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SiteverifyResult = { success: boolean; "error-codes"?: string[] };

/**
 * Turnstile トークンを検証して真偽を返す。secret/token 欠如・通信失敗は false（フェイルクローズ）。
 * remoteIp は CF-Connecting-IP を渡す（任意・siteverify の補助）。
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: remoteIp ?? undefined,
      }),
    });
    const data = (await res.json()) as SiteverifyResult;
    return data.success === true;
  } catch {
    return false;
  }
}
