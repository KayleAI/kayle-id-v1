import { describe, expect, test } from "bun:test";
import {
  assertOrganizationSlug,
  isOrganizationSlug,
  OrganizationSlugError,
} from "./organization-slug";

describe("organization slug policy", () => {
  test("accepts lowercase letters, numbers, and hyphens", () => {
    expect(isOrganizationSlug("acme")).toBe(true);
    expect(isOrganizationSlug("acme-123")).toBe(true);
    expect(() => assertOrganizationSlug("acme-123")).not.toThrow();
  });

  test("rejects empty or non-string values", () => {
    expect(isOrganizationSlug("")).toBe(false);
    expect(() => assertOrganizationSlug("")).toThrow(OrganizationSlugError);
    expect(() => assertOrganizationSlug(null)).toThrow(OrganizationSlugError);
  });

  test("rejects values that are unsafe in organization URLs", () => {
    for (const slug of ["Acme", "acme inc", "acme/inc", "acme.inc"]) {
      expect(isOrganizationSlug(slug)).toBe(false);
      expect(() => assertOrganizationSlug(slug)).toThrow(OrganizationSlugError);
    }
  });
});
