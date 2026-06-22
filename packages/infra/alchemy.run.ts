import alchemy from "alchemy";
import {
  D1Database,
  DurableObjectNamespace,
  Nextjs,
  Queue,
  R2Bucket,
  RateLimit,
  Worker,
} from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import { config } from "dotenv";

// 全環境変数はリポジトリルートの .env に一元管理する。
// `alchemy dev`/`deploy` は cwd=packages/infra で実行されるため、cwd 相対の
// `dotenv/config`（= packages/infra/.env）ではルートの .env を読めない。
// よって ../../ でルートの .env を明示ロードする。
// デプロイ(GitHub Actions)では process.env に値が注入され .env は無いためスキップ。
if (!process.env.ALCHEMY_DEPLOY) {
  config({ path: "../../.env" });
}

const stage = process.env.ALCHEMY_STAGE ?? "dev";

// 本番（stage=prod）のみワーカー名を固定し、workers.dev の URL を短く整える
// （Alchemy 既定の `<app>-<resource>-<stage>` 命名 = `yoyaku-web-prod` / `yoyaku-server-prod`
//  → `yoyaku` / `yoyaku-api`）。これにより web=yoyaku.<subdomain>.workers.dev、
//  server=yoyaku-api.<subdomain>.workers.dev になる。
// ローカル開発や他ステージでは name を渡さず既定命名のまま（例 `yoyaku-server-dev`）にして
// 既存の D1/DO state やステージ分離を壊さない。
const isProd = stage === "prod";
const webName = isProd ? { name: "yoyaku" } : {};
const serverName = isProd ? { name: "yoyaku-api" } : {};

const app = await alchemy("yoyaku", {
  stage,
  password: process.env.ALCHEMY_PASSWORD,
  // deploy/CI ではリモート state（DO + SQLite の state worker = `yoyaku-alchemy-state`）、
  // dev ではローカルファイルシステム state。ローカル state のまま CI で回すと毎回 state が
  // 空になりリソースの重複作成/孤児化を招くため、deploy 時のみリモート state に切り替える。
  // 認証は CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID と ALCHEMY_STATE_TOKEN から解決する。
  ...(process.env.ALCHEMY_DEPLOY
    ? {
        stateStore: (scope) =>
          new CloudflareStateStore(scope, {
            scriptName: "yoyaku-alchemy-state",
            forceUpdate: true,
          }),
      }
    : {}),
});

// ── 読み取り側: D1（read model + 認証）。マイグレーションは Alchemy が適用 ──
// adopt: deploy が途中失敗して「物理 D1 は作成済みだが Alchemy state には未記録」になった場合でも、
// 再実行時に "database already exists" で落ちず既存 D1 を採用して再開する（冪等な再デプロイ）。
const db = await D1Database("database", {
  migrationsDir: "../../packages/db/src/migrations",
  adopt: true,
});

// ── 書き込み側: イベントストア（Durable Objects 内 SQLite。集約=1 DO） ──
// className は apps/server の Worker entry が export するクラス名と一致させる。
const showing = DurableObjectNamespace("showing", { className: "ShowingDO", sqlite: true });
const reservation = DurableObjectNamespace("reservation", {
  className: "ReservationDO",
  sqlite: true,
});
// 作成系コマンドの冪等 ID 払い出し（getByName(idempotencyKey) で addressing）。
const intake = DurableObjectNamespace("intake", { className: "IntakeDO", sqlite: true });

// ── 投影配信: Outbox → Queue → consumer（at-least-once・順序保証なし） ──
const projectionQueue = await Queue("projection-queue");

// ── 投影 DLQ（毒メッセージ隔離・NFR-09/14）: maxRetries 超過分の退避先 ──
// consumer を付けて projection_dead_letters（D1）へ永続記録する。無 consumer の DLQ は 4 日で
// 自動削除されるため、可観測性・運用是正の土台として記録 consumer を必ず設ける。
const projectionDlq = await Queue("projection-dlq");

// ── 運用品質・回復性（Phase 10・NFR-14/16）: DO events のアーカイブ先 R2 ──
// snapshot で再構築できる古い events を R2 へ退避し DO からプルーン（1 行 2MB・容量上限の抑制）。
// 退避済み範囲の全リプレイ/as-of は R2 を参照する（runbook）。
const eventArchive = await R2Bucket("event-archive", { empty: false });

// ── 公平性/不正対策（Phase 09・NFR-18）: ネイティブ Rate Limiting バインディング ──
// 確保/決済/購入系の濫用抑止。zone 不要で workers.dev でも動作。period は 10 or 60 秒。
// 既定値は控えめに開始し受け入れ試験で調整（namespace_id は一意の正整数）。
const rateLimitStart = RateLimit({
  namespace_id: 1001,
  simple: { limit: 20, period: 60 },
});
const rateLimitAuthorize = RateLimit({
  namespace_id: 1002,
  simple: { limit: 10, period: 60 },
});
const rateLimitCapture = RateLimit({
  namespace_id: 1003,
  simple: { limit: 10, period: 60 },
});

// ── 公平性（Phase 09・FR-16）: Waiting Room の枠組み ──
// Cloudflare Waiting Room は **zone（カスタムドメイン）前提のエッジ機能**で、alchemy にリソースが無く
// workers.dev では未適用。自前整流は実装しない（要件 §3.2）。区分（riskTier=high_risk）で必須化し
// （domain の riskControls.waitingRoom）、実際の有効化はカスタムドメイン接続時に Cloudflare ダッシュボード/
// API で販売ルートへ適用する（Phase 11・閾値は実測で確定）。下記は区分別の初期閾値の目安（枠）。
export const WAITING_ROOM_BY_TIER = {
  general: null,
  popular: null,
  // total active users / new users per minute / session duration(min)。受け入れ試験で調整。
  high_risk: {
    totalActiveUsers: 5000,
    newUsersPerMinute: 2000,
    sessionDurationMinutes: 5,
  },
} as const;

// ── Hono Worker（fetch + queue consumer + DO クラス）──
// domains を設定しない = Cloudflare Workers 既定ドメイン（server.url = *.workers.dev）。
export const server = await Worker("server", {
  ...serverName,
  cwd: "../../apps/server",
  entrypoint: "src/index.ts",
  compatibility: "node",
  bindings: {
    DB: db,
    SHOWING: showing,
    RESERVATION: reservation,
    INTAKE: intake,
    PROJECTION_QUEUE: projectionQueue,
    PROJECTION_QUEUE_NAME: projectionQueue.name,
    PROJECTION_DLQ: projectionDlq,
    PROJECTION_DLQ_NAME: projectionDlq.name,
    BETTER_AUTH_URL: alchemy.env.BETTER_AUTH_URL!,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    GOOGLE_CLIENT_ID: alchemy.env.GOOGLE_CLIENT_ID!,
    GOOGLE_CLIENT_SECRET: alchemy.secret.env.GOOGLE_CLIENT_SECRET!,
    STRIPE_SECRET_KEY: alchemy.secret.env.STRIPE_SECRET_KEY!,
    STRIPE_WEBHOOK_SNAPSHOT_SECRET:
      alchemy.secret.env.STRIPE_WEBHOOK_SNAPSHOT_SECRET!,
    STRIPE_WEBHOOK_THIN_SECRET: alchemy.secret.env.STRIPE_WEBHOOK_THIN_SECRET!,
    STRIPE_CONNECT_COUNTRY: alchemy.env.STRIPE_CONNECT_COUNTRY ?? "JP",
    CORS_ORIGIN: alchemy.env.CORS_ORIGIN!,
    // 公平性/不正対策（Phase 09）。
    RATE_LIMIT_START: rateLimitStart,
    RATE_LIMIT_AUTHORIZE: rateLimitAuthorize,
    RATE_LIMIT_CAPTURE: rateLimitCapture,
    TURNSTILE_SECRET_KEY: alchemy.secret.env.TURNSTILE_SECRET_KEY!,
    // 運用品質・回復性（Phase 10）。管理トークン（運用ロール）＋ events アーカイブ R2。
    ADMIN_API_TOKEN: alchemy.secret.env.ADMIN_API_TOKEN!,
    EVENT_ARCHIVE: eventArchive,
  },
  // 投影 consumer は **直列化**する（maxConcurrency: 1）。Cloudflare Queues は同時実行が既定有効で
  // 順序保証も無いため、並行 invocation が同一集約の seq を前後/同時処理しうる。投影本体は行ごと
  // CAS（last_seq < seq）で順序非依存化済みのため maxConcurrency:1 は唯一の砦ではなく多層防御の一層だが、
  // 実並行化はスループット要求＋統合テストを前提に別途判断するため当面 1 に固定する（§13 runbook）。
  // maxRetries 超過の毒メッセージは **DLQ（projectionDlq）へ退避**し、DLQ consumer が
  // projection_dead_letters（D1）へ記録する（サイレントドロップを防止・指摘2）。
  eventSources: [
    {
      queue: projectionQueue,
      settings: {
        maxConcurrency: 1,
        maxRetries: 5,
        batchSize: 10,
        deadLetterQueue: projectionDlq,
      },
    },
    // DLQ consumer: 退避された毒メッセージを記録するだけ（再投影は別経路）。少バッチ・低頻度で十分。
    { queue: projectionDlq, settings: { maxConcurrency: 1, maxRetries: 3, batchSize: 10 } },
  ],
  // cron triggers（Phase 10・FR-27/NFR-14）: 照合は 15 分毎、events アーカイブは日次（深夜帯）。
  // scheduled ハンドラ（src/index.ts）が controller.cron で分岐する。
  crons: ["*/15 * * * *", "17 18 * * *"],
  dev: { port: 3000 },
});

// ── Next.js（OpenNext）。同じく domains を設定せず workers.dev 既定ドメイン ──
export const web = await Nextjs("web", {
  ...webName,
  cwd: "../../apps/web",
  bindings: {
    NEXT_PUBLIC_SERVER_URL: alchemy.env.NEXT_PUBLIC_SERVER_URL!,
    // Stripe 公開鍵（Phase 08）。Turnstile サイトキー（Phase 09・FR-17）。いずれも公開値（NEXT_PUBLIC_*）。
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      alchemy.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: alchemy.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
  },
  dev: { command: "pnpm next dev --port 3001" },
});

console.log(`server -> ${server.url}`);
console.log(`web    -> ${web.url}`);

await app.finalize();
