import type {
  D1Database,
  DurableObjectNamespace,
  Queue,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";
import type { Auth } from "@yoyaku/auth";

/** Better Auth が推論するセッション型（user/session）。型のみ参照（runtime import なし）。 */
type InferredSession = Auth["$Infer"]["Session"];

/** Queue メッセージ＝イベント envelope 全体（テーブル設計書 v1.3 §2.3）。 */
export type ProjectionMessage = {
  eventId: string;
  aggregateType: "Showing" | "Reservation";
  aggregateId: string;
  seq: number;
  eventType: string;
  schemaVersion: number;
  occurredAt: number;
  payload: unknown;
  metadata: { correlationId: string; causationId?: string; actor: string };
};

/** Worker バインディング（alchemy.run.ts の Worker("server") と一致。手動メンテ）。 */
export interface Bindings {
  DB: D1Database;
  SHOWING: DurableObjectNamespace;
  RESERVATION: DurableObjectNamespace;
  INTAKE: DurableObjectNamespace;
  PROJECTION_QUEUE: Queue<ProjectionMessage>;
  PROJECTION_QUEUE_NAME: string;
  // 投影 DLQ（毒メッセージ退避先）。DLQ consumer が projection_dead_letters へ記録する（指摘2）。
  PROJECTION_DLQ: Queue<ProjectionMessage>;
  PROJECTION_DLQ_NAME: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SNAPSHOT_SECRET: string;
  STRIPE_WEBHOOK_THIN_SECRET: string;
  STRIPE_CONNECT_COUNTRY: string;
  CORS_ORIGIN: string;
  // 公平性/不正対策（Phase 09）。
  // Cloudflare ネイティブ Rate Limiting バインディング（確保/決済経路・NFR-18）。
  RATE_LIMIT_START: RateLimit;
  RATE_LIMIT_AUTHORIZE: RateLimit;
  RATE_LIMIT_CAPTURE: RateLimit;
  // Turnstile siteverify 用の秘密鍵（高リスク公演で必須・FR-17）。
  TURNSTILE_SECRET_KEY: string;
  // 運用品質・回復性（Phase 10）。
  // 運用/管理エンドポイントのプラットフォーム管理トークン（X-Admin-Token・NFR-17）。
  ADMIN_API_TOKEN: string;
  // DO events のアーカイブ先 R2 バケット（容量対策・NFR-14/16）。
  EVENT_ARCHIVE: R2Bucket;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    /** sessionMiddleware が設定。未ログインは undefined（FR-30: ゲスト購入不可の判定に使う）。 */
    user: InferredSession["user"] | undefined;
    session: InferredSession["session"] | undefined;
    /** 有効な組織（RBAC スコープ）。未所属/未設定は null。 */
    activeOrganizationId: string | null;
  };
};
