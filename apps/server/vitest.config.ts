import { defineConfig } from "vitest/config";

// 投影/Outbox/alarm の純粋ヘルパ（gap 判定・次回 alarm・envelope 写像・真偽表）を Node 環境で検証。
// db（D1）/DO/Queue を伴う実挙動は Phase 04 の縦切り E2E（pnpm dev）で確認する。
// テストは db を import するモジュール（projections/*.projection・consumer 等）を読み込まないこと。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
