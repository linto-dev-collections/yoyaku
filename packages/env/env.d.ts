import type { server } from "@yoyaku/infra/alchemy.run";

/** Alchemy が宣言した `Worker("server")` のバインディングからEnv型を推論（codegen不要）。 */
export type CloudflareEnv = typeof server.Env;

declare global {
  type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends CloudflareEnv {}
  }
}
