import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @yoyaku/server は Worker 用コードを含むため、Next のバンドルから除外（型のみ参照）。
  serverExternalPackages: ["@yoyaku/server"],
  // mydevbox の HTTPS トンネル経由で next dev を開くと、HMR などの dev-only
  // endpoint の Origin が localhost と一致しないため明示的に許可する。
  allowedDevOrigins: ["3001.mydevbox.pp.ua"],
};

// OpenNext のローカル開発（wrangler/miniflare バインディングを next dev に接続）。
initOpenNextCloudflareForDev();

export default nextConfig;
