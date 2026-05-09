import { describe, expect, test } from "bun:test";
import {
  normalizeOrganizationName,
  ORGANIZATION_NAME_MAX_LENGTH,
  OrganizationNameError,
} from "./organization-name";

describe("organization name policy", () => {
  test("normalizes valid organization names", () => {
    expect(normalizeOrganizationName("Acme")).toBe("Acme");
    expect(normalizeOrganizationName("  Acme Inc  ")).toBe("Acme Inc");
  });

  test("rejects empty, non-string, and oversized organization names", () => {
    expect(() => normalizeOrganizationName("")).toThrow(OrganizationNameError);
    expect(() => normalizeOrganizationName("   ")).toThrow(
      OrganizationNameError
    );
    expect(() => normalizeOrganizationName(null)).toThrow(
      OrganizationNameError
    );
    expect(() =>
      normalizeOrganizationName("a".repeat(ORGANIZATION_NAME_MAX_LENGTH + 1))
    ).toThrow(OrganizationNameError);
  });

  test("rejects control characters", () => {
    expect(() => normalizeOrganizationName("Acme\nInc")).toThrow(
      OrganizationNameError
    );
  });
});
