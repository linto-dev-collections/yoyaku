"use client";

import { authClient } from "./auth-client";

/** 有効な組織（RBAC スコープ）を取得。コマンド body の organizationId・照会クエリに使う。 */
export function useActiveOrg() {
  const { data, isPending } = authClient.useActiveOrganization();
  return { org: data ?? null, orgId: data?.id ?? null, isPending };
}
