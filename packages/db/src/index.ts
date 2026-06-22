import { env } from "@yoyaku/env/server";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * D1 バインディング（Alchemy 注入）を Drizzle でラップ。read model + 認証の読み書きに使う。
 *
 * read-your-writes / 整合性（指摘 5・Phase 07 §4）:
 * - **コマンド→投影の非同期ラグ**（Queue consumer が別リクエストで read model を書く）は D1 では橋渡しできない。
 *   自己データの read-your-writes は **DO 直読**で満たす（`GET /reservations/:id`・`/me/tickets?merge=` の重畳）。
 * - **D1 Sessions API**（`env.DB.withSession(bookmark)`）は別レイヤの最適化＝**read replica のレプリカ鮮度**
 *   （同一論理セッション内の sequential consistency）用で、投影ラグの解決策ではない。読み取りレプリカ自体が
 *   未有効のため本シングルトン（primary 読み）で実害なし。bookmark 配線は Phase 10+ で導入する。
 */
export const db = drizzle(env.DB, { schema });
export { schema };
export type DB = typeof db;
