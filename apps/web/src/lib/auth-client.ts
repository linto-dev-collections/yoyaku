import { env } from "@yoyaku/env/web";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth クライアント（Google サインインのみ・Organization）。Cookie セッションを送る。 */
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_SERVER_URL,
  fetchOptions: { credentials: "include" },
  plugins: [organizationClient()],
});

export const { useSession, signIn, signOut, organization } = authClient;
