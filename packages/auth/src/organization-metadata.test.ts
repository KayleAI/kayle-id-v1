import { describe, expect, test } from "bun:test";
import {
  normalizeOrganizationMetadata,
  normalizeOrganizationPrivacyPolicyUrl,
  normalizeOrganizationTermsOfServiceUrl,
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
        privacyPolicyUrl: "https://acme.example/privacy",
        termsOfServiceUrl: "https://acme.example/terms",
      })
    ).toEqual({
      description: "Identity checks for Acme",
      website: "https://acme.example/path",
      privacyPolicyUrl: "https://acme.example/privacy",
      termsOfServiceUrl: "https://acme.example/terms",
    });
  });

  test("normalizes empty public metadata fields", () => {
    expect(
      normalizeOrganizationMetadata({
        description: "",
        website: "",
        privacyPolicyUrl: "",
        termsOfServiceUrl: "",
      })
    ).toEqual({
      description: null,
      website: null,
      privacyPolicyUrl: null,
      termsOfServiceUrl: null,
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

  test("rejects unsafe privacy policy and terms-of-service URLs", () => {
    expect(() =>
      normalizeOrganizationPrivacyPolicyUrl("javascript:alert(1)")
    ).toThrow(OrganizationMetadataError);
    expect(() =>
      normalizeOrganizationTermsOfServiceUrl(
        "https://user:pass@acme.example/terms"
      )
    ).toThrow(OrganizationMetadataError);
    expect(() =>
      normalizeOrganizationMetadata({
        privacyPolicyUrl: "ftp://acme.example/privacy",
      })
    ).toThrow(OrganizationMetadataError);
  });

  test("parses stored metadata defensively", () => {
    expect(
      parseStoredOrganizationMetadata(
        JSON.stringify({
          description: { text: "bad" },
          website: "https://acme.example",
          privacyPolicyUrl: "https://acme.example/privacy",
          termsOfServiceUrl: 42,
        })
      )
    ).toEqual({
      website: "https://acme.example",
      privacyPolicyUrl: "https://acme.example/privacy",
    });
    expect(parseStoredOrganizationMetadata("{")).toBeNull();
    expect(parseStoredOrganizationMetadata(null)).toBeNull();
  });
});
