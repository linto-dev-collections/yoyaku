# Yoyaku（予約）

座席指定チケット予約システム（ライブ/コンサート・劇場向け）。CQRS / Event Sourcing を Cloudflare 上に自前実装するモノレポ。

- 設計ドキュメント: [`../docs/`](../docs/)（要件定義 / ドメイン定義 / アーキ判断 / **テーブル設計書 v1.3**）
- 書き込み（正本）: **Durable Objects 内 SQLite** のイベントストア（`@yoyaku/event-store`）
- 読み取り: **Cloudflare D1** の read model ＋ 認証（`@yoyaku/db`、Better Auth）
- 配信: Outbox（DO 内）→ **Cloudflare Queues** → 投影 consumer（gap 検知 + `db.batch()` 原子適用）
- 認証: **Better Auth（Google サインインのみ）** + Organization（マルチテナント）
- 決済: **Stripe（都度決済 + Connect 手数料）**
- フロント: **Next.js + shadcn/ui**
- デプロイ: **Alchemy**（IaC は `packages/infra/alchemy.run.ts` の1ファイル）。**独自ドメインは使わず Cloudflare Workers 既定の `*.workers.dev`** に公開。

## 構成

```txt
apps/
  server/   @yoyaku/server  Hono Worker + Durable Objects(イベントストア) + Queue consumer(投影)
  web/      web             Next.js + shadcn/ui（OpenNext で Cloudflare 配置）
packages/
  domain/       @yoyaku/domain       純粋ドメイン（Decider: decide/evolve/initialState）。Cloudflare 非依存
  event-store/  @yoyaku/event-store  DO 内 SQLite スキーマ（events/outboxes/snapshots/streams/idempotency_keys, drizzle durable-sqlite）
  db/           @yoyaku/db           D1 read model + 認証スキーマ（drizzle d1）
  auth/         @yoyaku/auth         Better Auth（Google のみ + Organization）
  ui/           @yoyaku/ui           shadcn/ui
  env/          @yoyaku/env          バインディング型（typeof server.Env）+ env 検証
  infra/        @yoyaku/infra        Alchemy IaC（alchemy.run.ts）
  shared/       @yoyaku/shared       共有スキーマ/ユーティリティ
  config/       @yoyaku/config       共有 tsconfig プリセット
```

## セットアップ（このリポジトリはファイルのみ生成済み）

```bash
# 1. 依存導入
pnpm install

# 2. 環境変数（例）。詳細は packages/infra/alchemy.run.ts と各 .env を参照
#    CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / ALCHEMY_PASSWORD
#    BETTER_AUTH_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / STRIPE_SECRET_KEY ...

# 3. マイグレーション生成
pnpm db:generate        # D1 read model + 認証（drizzle-kit, d1-http）
pnpm es:generate        # イベントストア（drizzle-kit, durable-sqlite）

# 4. デプロイ（Alchemy → workers.dev 既定ドメイン）
pnpm deploy             # = turbo -F @yoyaku/infra deploy（ALCHEMY_DEPLOY=1 alchemy deploy）
pnpm destroy            # 破棄

# 開発
pnpm dev                # turbo dev（alchemy dev + next dev）
```

> **独自ドメインは使用しません。** `alchemy.run.ts` の `Worker`/`Nextjs` に `domains:` を設定していないため、Alchemy が `*.workers.dev` を自動割当します（`server.url` / `web.url` がそのまま公開 URL）。
