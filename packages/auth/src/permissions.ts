import { createAccessControl } from "better-auth/plugins/access";

/** 組織（Organization）の RBAC 文。公演管理・組織・メンバー操作。 */
const statement = {
  showing: ["create", "publish", "close", "read"],
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  showing: ["create", "publish", "close", "read"],
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
});

export const admin = ac.newRole({
  showing: ["create", "publish", "close", "read"],
  member: ["create", "update", "delete"],
});

export const member = ac.newRole({
  showing: ["read"],
});
