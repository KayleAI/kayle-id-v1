import { describe, expect, test } from "bun:test";
import {
  normalizeOrganizationBusinessJurisdiction,
  normalizeOrganizationBusinessName,
  normalizeOrganizationBusinessRegistrationNumber,
  normalizeOrganizationBusinessType,
  ORGANIZATION_BUSINESS_NAME_MAX_LENGTH,
  OrganizationBusinessDetailsError,
} from "./organization-business-details";

describe("normalizeOrganizationBusinessName", () => {
  test("undefined passes through (leave column unchanged)", () => {
    expect(normalizeOrganizationBusinessName(undefined)).toBeUndefined();
  });

  test("null clears the column", () => {
    expect(normalizeOrganizationBusinessName(null)).toBeNull();
  });

  test("empty / whitespace-only clears the column", () => {
    expect(normalizeOrganizationBusinessName("")).toBeNull();
    expect(normalizeOrganizationBusinessName("   ")).toBeNull();
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeOrganizationBusinessName("  Acme Corp  ")).toBe(
      "Acme Corp"
    );
  });

  test("rejects control characters", () => {
    expect(() => normalizeOrganizationBusinessName("AcmeCorp")).toThrow(
      OrganizationBusinessDetailsError
    );
  });

  test("rejects values over the max length", () => {
    expect(() =>
      normalizeOrganizationBusinessName(
        "x".repeat(ORGANIZATION_BUSINESS_NAME_MAX_LENGTH + 1)
      )
    ).toThrow(OrganizationBusinessDetailsError);
  });

  test("rejects non-string types", () => {
    expect(() => normalizeOrganizationBusinessName(42)).toThrow(
      OrganizationBusinessDetailsError
    );
  });
});

describe("normalizeOrganizationBusinessJurisdiction", () => {
  test("undefined passes through", () => {
    expect(
      normalizeOrganizationBusinessJurisdiction(undefined)
    ).toBeUndefined();
  });

  test("trims and accepts a country name", () => {
    expect(normalizeOrganizationBusinessJurisdiction(" Earth (Planet) ")).toBe(
      "Earth (Planet)"
    );
  });

  test("rejects control characters", () => {
    expect(() =>
      normalizeOrganizationBusinessJurisdiction("Earth (Planet)")
    ).toThrow(OrganizationBusinessDetailsError);
  });
});

describe("normalizeOrganizationBusinessType", () => {
  test("undefined passes through", () => {
    expect(normalizeOrganizationBusinessType(undefined)).toBeUndefined();
  });

  test("null and empty string clear the column", () => {
    expect(normalizeOrganizationBusinessType(null)).toBeNull();
    expect(normalizeOrganizationBusinessType("")).toBeNull();
  });

  test("accepts canonical enum values", () => {
    expect(normalizeOrganizationBusinessType("sole")).toBe("sole");
    expect(normalizeOrganizationBusinessType("business")).toBe("business");
  });

  test("rejects anything else", () => {
    expect(() => normalizeOrganizationBusinessType("partnership")).toThrow(
      OrganizationBusinessDetailsError
    );
    expect(() => normalizeOrganizationBusinessType(42)).toThrow(
      OrganizationBusinessDetailsError
    );
  });
});

describe("normalizeOrganizationBusinessRegistrationNumber", () => {
  test("trims and accepts a registration string", () => {
    expect(
      normalizeOrganizationBusinessRegistrationNumber("  12345678  ")
    ).toBe("12345678");
  });

  test("null clears", () => {
    expect(normalizeOrganizationBusinessRegistrationNumber(null)).toBeNull();
  });
});
