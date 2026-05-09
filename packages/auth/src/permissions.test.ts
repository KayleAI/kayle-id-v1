import { describe, expect, test } from "bun:test";
import { hasOrgRole } from "./permissions";

describe("hasOrgRole", () => {
  test("accepts a single role that meets the required level", () => {
    expect(hasOrgRole("owner", "admin")).toBe(true);
    expect(hasOrgRole("admin", "member")).toBe(true);
  });

  test("accepts comma-separated role sets from Better Auth membership rows", () => {
    expect(hasOrgRole("member,admin", "admin")).toBe(true);
    expect(hasOrgRole("member,owner", "admin")).toBe(true);
  });

  test("rejects role sets that do not meet the required level", () => {
    expect(hasOrgRole("member", "admin")).toBe(false);
    expect(hasOrgRole("member,unknown", "admin")).toBe(false);
  });
});
