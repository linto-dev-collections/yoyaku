# yoyaku 本番デプロイガイド

Cloudflare Workers + Alchemy（TypeScript IaC）で `*.workers.dev` 上に運用する手順。
`main` への push で GitHub Actions（`.github/workflows/ci.yml`）が CI → deploy を実行し、
Alchemy が D1 / Durable Object / Queues / R2 / Workers をまとめて作成・更新する。

以下の例では自分の workers.dev サブドメインを `linto-dev` と表記する。

> なお Cloudflare 環境は本番（`stage=prod`）だが、**Stripe はテストモード**で運用する（API キー・Webhook 署名シークレット・Connect 接続アカウントはすべて test のもので揃える。実課金は発生しない）。

---

## 全体像

```txt
                 Browser (buyers / organizers)
                          │  HTTPS (fetch / Hono RPC, cookie session)
                          ▼
      ┌──────────────────────────────────────────────────┐
      │ Web - Next.js / OpenNext                         │
      │ yoyaku.linto-dev.workers.dev                     │
      │ Purchase-flow UI + organizer dashboard (CSR)     │
      └──────────────────────────────────────────────────┘
                          │  fetch (credentials: include)
                          ▼
      ┌──────────────────────────────────────────────────┐
      │ Server - Hono + Better Auth (Google)             │
      │ yoyaku-api.linto-dev.workers.dev                 │
      │ API + Stripe webhooks + Queue/Cron consumers     │
      └───────────┬───────────────────┬──────────────────┘
                  │                   │
            writes (source       reads / auth
             of truth)                │
                  │                   │
                  ▼                   ▼
      ┌───────────────────┐  ┌────────────────────────────┐
      │ Durable Objects   │  │ D1 (SQLite)                │
      │  ShowingDO        │  │  read model + Better Auth  │
      │  ReservationDO    │  │  (organization)            │
      │  IntakeDO         │  └────────────────────────────┘
      │  = SQLite-backed  │
      │    DO (event      │      ┌─────────────────────────┐
      │    store)         │      │ R2: event-archive       │
      └─────────┬─────────┘      │ (cold-store old events) │
                │ Outbox         └─────────────────────────┘
                ▼
      ┌───────────────────┐
      │ Cloudflare Queues │  projection-queue -> projection consumer (D1 read model)
      │  + projection-dlq │  poison messages recorded to D1 by the DLQ consumer
      └───────────────────┘

      External: Stripe (one-off payments + Connect fees) / Cloudflare Turnstile (high_risk showings)
      Alchemy also provisions an internal state worker `yoyaku-alchemy-state` (no access needed).
```

- **Web**：座席選択 → 確保 → 決済 → 確認の購入フロー、主催の公演管理・座席・売上ダッシュボード。**すべて CSR**（`credentials:"include"` でブラウザから API を叩く）。
- **Server**：Better Auth（Google サインインのみ）＋ 予約 API ＋ Stripe webhook ＋ Queue consumer（投影）＋ Cron（照合 15 分毎・events アーカイブ日次）。Durable Object クラス（ShowingDO/ReservationDO/IntakeDO）も同じ Worker が export。
- **書き込み正本**：DO 内 SQLite のイベントストア。**読み取り**：D1 の read model。間を Outbox → Queues → 投影 consumer がつなぐ。
- 購入者は**ログイン必須**（FR-30・ゲスト購入不可）。認証は Google のみ。

---

## 前提条件

- `gh`（GitHub CLI）を `gh auth login` 済みで、本リポジトリのディレクトリ内で実行する。
- **Cloudflare アカウント**で以下が有効であること:
  - **Workers Paid プラン（$5/月〜）**。本アプリは **Cloudflare Queues** を使うため Paid が必須（Queues は無料プラン非対応）。Durable Objects（SQLite backed）自体は無料プランでも動くが、Queues のため実質 Paid が要る。
  - **R2 を有効化**（`event-archive` バケット作成のため。R2 は無料枠ありだが事前の有効化＝支払い方法登録が必要）。
  - **workers.dev サブドメインが有効**（Step 0）。
- **Stripe アカウント**（今回は**テストモード**で運用。実課金は発生しない）。**Connect を有効化**（テストモードでも有効化は必要。手数料付き都度決済に使う）。
- **Google Cloud** の OAuth クライアント（ホスト/購入者ログイン）。

---

## Step 0: workers.dev サブドメインと URL の確認

1. Cloudflare ダッシュボード → **Workers & Pages** → **Settings** の **Subdomain**（`xxxxx.workers.dev` の `xxxxx`）を確認。未登録なら任意名（例 `linto-dev`）を登録。
2. 本番（`stage=prod`）は `packages/infra/alchemy.run.ts` でワーカー名を固定しているため、URL は以下になる:

   | 役割 | Worker 名 | URL |
   | --- | --- | --- |
   | Web（Next.js） | `yoyaku` | `https://yoyaku.linto-dev.workers.dev` |
   | Server（Hono/API） | `yoyaku-api` | `https://yoyaku-api.linto-dev.workers.dev` |
   | Alchemy state | `yoyaku-alchemy-state` | 内部利用（アクセス不要） |

   > 名前固定は `alchemy.run.ts` の `isProd` 分岐（`name: "yoyaku"` / `name: "yoyaku-api"`）による。`stage` が prod 以外だと既定命名（`yoyaku-web-dev` 等）に戻る。

3. **Cookie について（liveboard との違い）**：本アプリは web/api が別サブドメイン（`yoyaku.` と `yoyaku-api.`）だが、`workers.dev` は Public Suffix List 登録済みのため両者は**同一サイト（same-site）**扱い。セッション cookie は API オリジンに発行され、web からの fetch は `credentials:"include"` で送られる（SameSite=Lax で送信可）。**SSR からの認証 fetch は無く**（ダッシュボードは全て CSR）、`COOKIE_DOMAIN` の設定は**不要**（環境変数自体が存在しない）。

---

## Step 1: Cloudflare API Token / Account ID

1. ダッシュボード → **My Profile** → **API Tokens** → **Create Token** → **Custom token** で以下を付与:

   | リソース | 権限 | 用途 |
   | --- | --- | --- |
   | Account → Workers Scripts | Edit | Worker / Durable Object / Rate Limit バインディング / state worker |
   | Account → Workers R2 Storage | Edit | `event-archive` バケット |
   | Account → Queues | Edit | `projection-queue` / `projection-dlq` |
   | Account → D1 | Edit | read model + 認証 DB（マイグレーション適用） |
   | Account → Account Settings | Read | アカウント解決 |
   | User → User Details | Read | Alchemy のアカウント/ユーザー解決 |
   | User → Memberships | Read | 同上 |

   > 近道: テンプレート **「Edit Cloudflare Workers」**（Workers Scripts / KV / R2 / Routes Edit ＋ Account Settings Read を含む）を選び、そこに **D1: Edit** と **Queues: Edit** を追加してもよい。

   作成後に表示される値をコピー（**再表示不可**）→ `CLOUDFLARE_API_TOKEN`。
2. ダッシュボード右サイドの **Account ID** をコピー → `CLOUDFLARE_ACCOUNT_ID`。

---

## Step 2: 本番用シークレットの生成

それぞれ別の値を生成する:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET（認証セッション署名）
openssl rand -base64 32   # ALCHEMY_PASSWORD（state 暗号化）
openssl rand -base64 32   # ALCHEMY_STATE_TOKEN（リモート state worker の認証）
openssl rand -hex 32      # ADMIN_API_TOKEN（運用/管理エンドポイントの X-Admin-Token）
```

> `ALCHEMY_PASSWORD` / `ALCHEMY_STATE_TOKEN` は**一度設定したら変更しない**（既存 state を復号・認証できなくなる）。

---

## Step 3: Google Sign-in（OAuth Client）

認証は Google サインインのみ（email/password は無効）。`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` は**必須**（空だと Worker 起動時の env 検証で失敗する）。

1. [Google Cloud Console](https://console.cloud.google.com/) で OAuth 同意画面を構成（scope: `openid email profile`）。
2. **認証情報** → **OAuth クライアント ID**（種類: ウェブアプリケーション）を作成。
3. **承認済みのリダイレクト URI** に以下を追加（Better Auth 既定 = `${BETTER_AUTH_URL}/api/auth/callback/google`）:

   ```txt
   https://yoyaku-api.linto-dev.workers.dev/api/auth/callback/google
   ```

4. **Client ID** → `GOOGLE_CLIENT_ID`、**Client Secret** → `GOOGLE_CLIENT_SECRET`。

---

## Step 4: Stripe（テストモード・都度決済 + Connect + Webhook ×2）

> **今回はテストモードで運用する。** Dashboard 右上の **Test mode** トグルを ON にし、以下の API キー・Webhook 署名シークレット・Connect 接続アカウントは**すべてテストモードのもの**で揃える。test と live は鍵も署名シークレットも完全に別物で、混在させると webhook の署名検証に失敗する（[Stripe: test/live はエンドポイント・署名シークレットが別](https://docs.stripe.com/webhooks)）。実課金は発生しない。

1. [Stripe Dashboard（テスト）](https://dashboard.stripe.com/test/apikeys) → **Developers → API keys**（Test mode）:
   - **Secret key**（`sk_test_…`）→ `STRIPE_SECRET_KEY`
   - **Publishable key**（`pk_test_…`）→ `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`（公開値・ブラウザに露出）
2. **Connect を有効化**（Settings → Connect）。決済時に application fee を取る Connect 構成。テストモードでは接続アカウントもテスト用で、オンボーディングはテストデータ（テスト用の本人確認情報・口座）で完了できる。`STRIPE_CONNECT_COUNTRY` は運用国（日本運用は `JP`）。
3. **Webhook を 2 系統**作成する（本アプリは v1 と v2 を別エンドポイントで受ける）。**いずれも Test mode の状態で作成**し、得られる署名シークレットはテストモード用:

   | 種別 | エンドポイント URL | 購読イベント | 署名シークレット |
   | --- | --- | --- | --- |
   | **snapshot**（v1） | `https://yoyaku-api.linto-dev.workers.dev/api/stripe/webhook/snapshot` | `payment_intent.amount_capturable_updated`, `payment_intent.succeeded` | `STRIPE_WEBHOOK_SNAPSHOT_SECRET` |
   | **thin**（Accounts v2 / Connect） | `https://yoyaku-api.linto-dev.workers.dev/api/stripe/webhook/thin` | `v2.core.account.created`, `v2.core.account[configuration.recipient].updated`, `v2.core.account[configuration.recipient].capability_status_updated`, `v2.core.account[requirements].updated` | `STRIPE_WEBHOOK_THIN_SECRET` |

   - snapshot は従来型 Webhook endpoint（**Developers → Webhooks**）。thin は **v2 イベント（thin events / event destinations）** で Connect の recipient account 状態同期に使う。各エンドポイントの **Signing secret（`whsec_…`・テストモードの値）** をそれぞれの環境変数に設定する。
   - 旧 `/api/stripe/webhook`（無印）は `deprecated_webhook_endpoint` を返すので使わない。

---

## Step 5: Cloudflare Turnstile（high_risk 公演のみ）

Turnstile は **`riskTier = high_risk` の公演でのみ発動**（確保/決済前に siteverify、失敗は 403 フェイルクローズ）。`general` / `popular` では描画も検証もしない。ただし環境変数自体は**必須**（空だと起動時 env 検証で失敗）。

1. [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) で **Add widget**:
   - **Hostname**：**Web 側**のホスト名 `yoyaku.linto-dev.workers.dev`（ウィジェットを描画するのは web。サブドメインは自動的に許可される）。
   - **Widget Mode**：**Managed**（推奨。web は 65px の可視領域を確保しているので可視モードが UI と整合）。
   - **Pre-clearance**：**OFF**（workers.dev はゾーン外でセキュリティルールが無いため無関係）。
2. 発行された **Site Key**（公開）→ `NEXT_PUBLIC_TURNSTILE_SITE_KEY`、**Secret Key** → `TURNSTILE_SECRET_KEY`。

> high_risk 公演を当面使わない場合でも env は必須。Cloudflare のテストキー（site `1x00000000000000000000AA` / secret `1x0000000000000000000000000000000AA`、**常に成功**）を入れておけば起動はする（＝Bot 対策は無効）。実運用で効かせるには実キーを使うこと。

---

## Step 6: GitHub に Secrets / Variables を登録

### 6-1. Secrets（11 件）

`gh secret set <NAME>` は対話入力（シェル履歴に残らない）:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set ALCHEMY_PASSWORD
gh secret set ALCHEMY_STATE_TOKEN
gh secret set BETTER_AUTH_SECRET
gh secret set GOOGLE_CLIENT_SECRET
gh secret set STRIPE_SECRET_KEY
gh secret set STRIPE_WEBHOOK_SNAPSHOT_SECRET
gh secret set STRIPE_WEBHOOK_THIN_SECRET
gh secret set TURNSTILE_SECRET_KEY
gh secret set ADMIN_API_TOKEN
```

### 6-2. Variables（7 件）

`linto-dev` を自分のサブドメインに置換して実行:

```bash
gh variable set NEXT_PUBLIC_SERVER_URL             --body "https://yoyaku-api.linto-dev.workers.dev"
gh variable set BETTER_AUTH_URL                    --body "https://yoyaku-api.linto-dev.workers.dev"
gh variable set CORS_ORIGIN                        --body "https://yoyaku.linto-dev.workers.dev"
gh variable set STRIPE_CONNECT_COUNTRY             --body "JP"
gh variable set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY --body "pk_test_51TlAfLPVbpXL9OHkStOUfHAN727Cu0D6Fps6FFTi5TBSt4NgYFtt4AedzrOS4tFLfVAfgPfnJD5ZyHaE96Y8GrrK0089zU0dBI"
gh variable set NEXT_PUBLIC_TURNSTILE_SITE_KEY     --body "0x4AAAAAADpPig2-06E42sVF"
gh variable set GOOGLE_CLIENT_ID                   --body "641765280794-r91q82hvmddb85557i9t8ni880o7nlf8.apps.googleusercontent.com"
```

- `CORS_ORIGIN` には **Web の origin** を指定（API の Hono CORS と一致しないと、ブラウザからの API 呼び出しが弾かれる）。
- `BETTER_AUTH_URL` / `NEXT_PUBLIC_SERVER_URL` は **API の origin**（= `yoyaku-api`）。
- `NEXT_PUBLIC_*` は**ビルド時にバンドルへ埋め込まれる**ため、変更時は再 push（再ビルド）が必要。

### 6-3. 確認

```bash
gh secret list     # 11 件
gh variable list   # 7 件
```

---

## Step 7: デプロイ

`main` への push で CI（biome / knip / 型 / depcruise / test / build）→ deploy が走る。deploy では `alchemy deploy` が
**D1 作成＋read model マイグレーション適用**、Durable Object / Queues / R2 の作成、server / web のビルド＆デプロイ、state worker 作成を一括実行する。

```bash
git push origin main
```

> コード変更が無い場合は GitHub の **Actions** タブから対象ワークフローを **Re-run** でも実行できる。
>
> **マイグレーションについて**：D1（read model + 認証）のマイグレーションは Alchemy が `migrationsDir`（`packages/db/src/migrations`、生成済み・コミット済み）から適用する。イベントストア（DO 内 SQLite）のスキーマは各 DO 起動時に `migrateEventStore`（`blockConcurrencyWhile`）が適用するため**別ステップ不要**。

---

## Step 8: デプロイ後の確認

1. Actions → 最新実行 → **deploy** → **Deploy** ログ末尾の URL が Step 6 の Variable と一致するか確認:

   ```txt
   server -> https://yoyaku-api.linto-dev.workers.dev
   web    -> https://yoyaku.linto-dev.workers.dev
   ```

   異なる場合は該当 Variable（と Google のリダイレクト URI / Stripe webhook URL）を実際の値に直して再 push。
2. ヘルスチェック: `curl https://yoyaku-api.linto-dev.workers.dev/health` → `{"status":"ok"}`。
3. Web で **Google サインイン**が成功し、ダッシュボードが表示される（cookie セッションが API に送られる）。
4. 主催で **組織作成 → Stripe Connect 接続 → 公演登録（Draft）→ 座席取込 → 公開（OnSale）**。Connect オンボーディングはテストモードのテストデータで完了できる。
5. 別ブラウザ（購入者）で公演ページ → **座席選択 → 確保（hold）→ 決済（オーソリ → キャプチャ）→ 確認**。決済はテストカード **`4242 4242 4242 4242`**（未来の有効期限・任意の CVC・任意の郵便番号）を使う。Stripe ダッシュボード（**Test mode**）の **Developers → Webhooks / Event destinations** で snapshot/thin 双方が 2xx を返しているか確認。
6. 座席状態・売上ダッシュボードが**投影 consumer 経由で反映**される（Queues → D1 read model）。反映は非同期（at-least-once）。
7. **Cron** の動作（任意）: 照合 15 分毎・events アーカイブ日次は Worker の scheduled で自動実行。管理 API（`/admin/*`）は `X-Admin-Token: <ADMIN_API_TOKEN>` で叩ける。

---

## 補足

- **破棄**: `pnpm destroy`（`ALCHEMY_DEPLOY=1 alchemy destroy`）。CI 経由で消す場合は `ALCHEMY_STAGE=prod` とリモート state の認証（`ALCHEMY_STATE_TOKEN` / `CLOUDFLARE_*`）が必要。**D1 / DO / R2 のデータも消える**ので注意。
- **ローカルデプロイ（緊急時）**: ルート `.env` に上記値を入れ、`ALCHEMY_DEPLOY=1 ALCHEMY_STAGE=prod ALCHEMY_STATE_TOKEN=... pnpm deploy`。ただし通常は CI 経由を推奨（state の一貫性のため）。
- **dev ステージとの分離**: ローカル `pnpm dev` は `stage=dev`（既定命名 `yoyaku-server-dev` 等・ローカルファイル state）。prod とは Worker 名も state も分離されるため、本番リソースを壊さない。
- **既知の前提**: Queues は Workers Paid、R2 は有効化済みであること（Step「前提条件」）。未充足だと deploy が権限/プランエラーで失敗する。
