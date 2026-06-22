import { hc } from "hono/client";
import type { AppType } from "./app";

/** Web から型付き RPC するためのクライアントファクトリ（@yoyaku/server/hc）。 */
export const hcWithType = (...args: Parameters<typeof hc>) =>
  hc<AppType>(...args);

export type { AppType };
