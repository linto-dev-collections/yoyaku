/**
 * 組織ロールの順序判定（純粋・db/auth に非依存＝node vitest で単体テスト可）。
 * BR-12: 組織スコープ操作は所属組織の権限あるメンバーのみ。owner ≥ admin ≥ member。
 */
export type OrgRole = "owner" | "admin" | "member";

const RANK: Record<OrgRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

const rankOf = (role: string): number | undefined =>
  RANK[role.trim() as OrgRole];

/**
 * member の role 文字列が要求ロール `min` 以上か。
 * Better Auth はカンマ区切りで複数ロールを保持しうるため、最大ランクで判定する。
 * 未知ロール・未所属（null/空）は常に false（最小権限の原則）。
 */
export const hasRole = (
  role: string | null | undefined,
  min: OrgRole,
): boolean => {
  if (!role) return false;
  const ranks = role
    .split(",")
    .map(rankOf)
    .filter((n): n is number => n !== undefined);
  if (ranks.length === 0) return false;
  return Math.max(...ranks) >= RANK[min];
};
