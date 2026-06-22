import { defineConfig } from "vitest/config";

// 純粋ユーティリティ（金額整形・残時間・JST 壁時計変換・座席選択 all-or-nothing）を Node 環境で検証。
// RPC/React コンポーネントは含めない（手動 E2E で確認）。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
