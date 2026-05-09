import { describe, expect, test } from "bun:test";
import {
  normalizeOrganizationMetadata,
  normalizeOrganizationWebsiteUrl,
  OrganizationMetadataError,
  parseStoredOrganizationMetadata,
} from "./organization-metadata";

describe("organization metadata policy", () => {
  test("accepts expected public metadata fields", () => {
    expect(
      normalizeOrganizationMetadata({
        description: "Identity checks for Acme",
        website: "https://acme.example/path",
      })
    ).toEqual({
      description: "Identity checks for Acme",
      website: "https://acme.example/path",
    });
  });

  test("normalizes empty public metadata fields", () => {
    expect(
      normalizeOrganizationMetadata({ description: "", website: "" })
    ).toEqual({
      description: null,
      website: null,
    });
    expect(normalizeOrganizationMetadata(undefined)).toBeUndefined();
  });

  test("rejects non-string fields and unknown metadata keys", () => {
    expect(() =>
      normalizeOrganizationMetadata({ description: { text: "bad" } })
    ).toThrow(OrganizationMetadataError);
    expect(() =>
      normalizeOrganizationMetadata({
        website: { href: "https://bad.example" },
      })
    ).toThrow(OrganizationMetadataError);
    expect(() =>
      normalizeOrganizationMetadata({ billingTier: "enterprise" })
    ).toThrow(OrganizationMetadataError);
  });

  test("rejects unsafe website URLs", () => {
    expect(() =>
      normalizeOrganizationWebsiteUrl("javascript:alert(1)")
    ).toThrow(OrganizationMetadataError);
    expect(() =>
      normalizeOrganizationWebsiteUrl("https://user:pass@example.com")
    ).toThrow(OrganizationMetadataError);
  });

  test("parses stored metadata defensively", () => {
    expect(
      parseStoredOrganizationMetadata(
        JSON.stringify({
          description: { text: "bad" },
          website: "https://acme.example",
        })
      )
    ).toEqual({ website: "https://acme.example" });
    expect(parseStoredOrganizationMetadata("{")).toBeNull();
    expect(parseStoredOrganizationMetadata(null)).toBeNull();
  });
});
