/** RPC エラー応答の整形（401/403/409/422 等を日本語文言へ・FR-37/§5）。 */
export type ApiErrorBody = { error?: string; message?: string };

/** HTTP ステータス（＋サーバ文言）からユーザー向け日本語メッセージを得る。 */
export function statusMessage(status: number, body?: ApiErrorBody): string {
  if (body?.message) return body.message;
  switch (status) {
    case 401:
      return "サインインが必要です。";
    case 403:
      return "この操作の権限がありません。";
    case 404:
      return "対象が見つかりませんでした。";
    case 409:
      return "競合、または状態が変わっています（時間切れ・重複など）。最新の状態を取得してください。";
    case 413:
      return "データが大きすぎます。分割してください。";
    case 422:
      return "入力内容を確認してください。";
    default:
      return `エラーが発生しました（${status}）。`;
  }
}

// hono の ClientResponse を受けるための構造的型（DOM Response とは別。webSocket 等を要求しない）。
type JsonLike = { json: () => Promise<unknown> };
type ResponseLike = JsonLike & { status: number };

/** レスポンスから JSON を安全に読む（本文が無い/壊れていれば undefined）。 */
export async function readJson<T>(res: JsonLike): Promise<T | undefined> {
  try {
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/** 失敗レスポンスからユーザー向けメッセージを生成。 */
export async function errorMessageFrom(res: ResponseLike): Promise<string> {
  const body = await readJson<ApiErrorBody>(res);
  return statusMessage(res.status, body);
}
