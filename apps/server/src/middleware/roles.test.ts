import { describe, expect, it } from "vitest";
import { hasRole } from "./roles";

describe("hasRole (owner ≥ admin ≥ member)", () => {
  it("owner satisfies every requirement", () => {
    expect(hasRole("owner", "owner")).toBe(true);
    expect(hasRole("owner", "admin")).toBe(true);
    expect(hasRole("owner", "member")).toBe(true);
  });

  it("admin satisfies admin/member but not owner", () => {
    expect(hasRole("admin", "owner")).toBe(false);
    expect(hasRole("admin", "admin")).toBe(true);
    expect(hasRole("admin", "member")).toBe(true);
  });

  it("member satisfies only member", () => {
    expect(hasRole("member", "owner")).toBe(false);
    expect(hasRole("member", "admin")).toBe(false);
    expect(hasRole("member", "member")).toBe(true);
  });

  it("treats null/undefined/empty as no access", () => {
    expect(hasRole(null, "member")).toBe(false);
    expect(hasRole(undefined, "member")).toBe(false);
    expect(hasRole("", "member")).toBe(false);
  });

  it("rejects unknown roles", () => {
    expect(hasRole("guest", "member")).toBe(false);
    expect(hasRole("superadmin", "owner")).toBe(false);
  });

  it("uses the highest rank for comma-separated roles", () => {
    expect(hasRole("member,owner", "admin")).toBe(true);
    expect(hasRole("member, admin", "admin")).toBe(true);
    expect(hasRole("member,guest", "admin")).toBe(false);
  });
});
