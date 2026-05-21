import { describe, expect, test } from "bun:test";
import {
  getOrganizationComplianceProfileStatus,
  normalizeOrganizationMetadata,
  normalizeOrganizationPrivacyPolicyUrl,
  normalizeOrganizationSupportEmail,
  normalizeOrganizationTermsOfServiceUrl,
  normalizeOrganizationWebsiteUrl,
  OrganizationMetadataError,
  parseStoredOrganizationMetadata,
} from "./organization-metadata";

describe("organization metadata policy", () => {
  test("accepts expected public metadata fields", () => {
    expect(
      normalizeOrganizationMetadata({
        article6Basis: "legitimate interests",
        article9Condition: "explicit consent",
        appealUrl: "https://acme.example/review",
        complaintsUrl: "https://acme.example/complaints",
        controllerJurisdiction: "Earth (Planet)",
        description: "Identity checks for Acme",
        fallbackIdvUrl: "https://acme.example/manual-idv",
        legalControllerName: "Acme Ltd",
        website: "https://acme.example/path",
        privacyPolicyUrl: "https://acme.example/privacy",
        supportEmail: "Support@Acme.Example",
        termsOfServiceUrl: "https://acme.example/terms",
        usesKayleForConsequentialDecisions: true,
      })
    ).toEqual({
      article6Basis: "legitimate interests",
      article9Condition: "explicit consent",
      appealUrl: "https://acme.example/review",
      complaintsUrl: "https://acme.example/complaints",
      controllerJurisdiction: "Earth (Planet)",
      description: "Identity checks for Acme",
      fallbackIdvUrl: "https://acme.example/manual-idv",
      legalControllerName: "Acme Ltd",
      website: "https://acme.example/path",
      privacyPolicyUrl: "https://acme.example/privacy",
      supportEmail: "support@acme.example",
      termsOfServiceUrl: "https://acme.example/terms",
      usesKayleForConsequentialDecisions: true,
    });
  });

  test("normalizes empty public metadata fields", () => {
    expect(
      normalizeOrganizationMetadata({
        description: "",
        website: "",
        privacyPolicyUrl: "",
        termsOfServiceUrl: "",
        supportEmail: "",
        usesKayleForConsequentialDecisions: null,
      })
    ).toEqual({
      description: null,
      website: null,
      privacyPolicyUrl: null,
      termsOfServiceUrl: null,
      supportEmail: null,
      usesKayleForConsequentialDecisions: null,
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
    expect(() =>
      normalizeOrganizationMetadata({
        usesKayleForConsequentialDecisions: "false",
      })
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
    expect(() =>
      normalizeOrganizationMetadata({
        fallbackIdvUrl: "javascript:alert(1)",
      })
    ).toThrow(OrganizationMetadataError);
  });

  test("rejects invalid support email", () => {
    expect(normalizeOrganizationSupportEmail("Help@Example.COM")).toBe(
      "help@example.com"
    );
    expect(() => normalizeOrganizationSupportEmail("not-an-email")).toThrow(
      OrganizationMetadataError
    );
  });

  test("parses stored metadata defensively", () => {
    expect(
      parseStoredOrganizationMetadata(
        JSON.stringify({
          description: { text: "bad" },
          website: "https://acme.example",
          privacyPolicyUrl: "https://acme.example/privacy",
          termsOfServiceUrl: 42,
          supportEmail: "help@acme.example",
          usesKayleForConsequentialDecisions: false,
        })
      )
    ).toEqual({
      website: "https://acme.example",
      privacyPolicyUrl: "https://acme.example/privacy",
      supportEmail: "help@acme.example",
      usesKayleForConsequentialDecisions: false,
    });
    expect(parseStoredOrganizationMetadata("{")).toBeNull();
    expect(parseStoredOrganizationMetadata(null)).toBeNull();
  });

  test("requires a complete compliance profile for production sessions", () => {
    expect(
      getOrganizationComplianceProfileStatus({
        legalControllerName: "Acme Ltd",
        controllerJurisdiction: "Earth (Planet)",
        privacyPolicyUrl: "https://acme.example/privacy",
        supportEmail: "help@acme.example",
        article6Basis: "legitimate interests",
        article9Condition: "explicit consent",
        usesKayleForConsequentialDecisions: false,
      })
    ).toEqual({
      complete: true,
      hasFallbackPath: false,
      hasNonConsequentialUseDeclaration: true,
      missingFields: [],
    });

    expect(
      getOrganizationComplianceProfileStatus({
        legalControllerName: "Acme Ltd",
        controllerJurisdiction: "Earth (Planet)",
        privacyPolicyUrl: "https://acme.example/privacy",
        supportEmail: "help@acme.example",
        article6Basis: "legitimate interests",
        article9Condition: "explicit consent",
        fallbackIdvUrl: "https://acme.example/manual-idv",
        appealUrl: "https://acme.example/review",
        usesKayleForConsequentialDecisions: true,
      })
    ).toEqual({
      complete: true,
      hasFallbackPath: true,
      hasNonConsequentialUseDeclaration: false,
      missingFields: [],
    });

    expect(
      getOrganizationComplianceProfileStatus({
        legalControllerName: "Acme Ltd",
        controllerJurisdiction: "Earth (Planet)",
        privacyPolicyUrl: "https://acme.example/privacy",
        supportEmail: "help@acme.example",
        article6Basis: "legitimate interests",
        article9Condition: "explicit consent",
        usesKayleForConsequentialDecisions: true,
      }).missingFields
    ).toEqual(["fallbackIdvUrl", "appealUrl"]);
  });
});
