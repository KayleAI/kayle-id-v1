import { describe, expect, test } from "bun:test";
import {
  getOrganizationBusinessDetailsStatus,
  getOrganizationOnboardingStatus,
  getOrganizationPublicDetailsStatus,
} from "./organization-onboarding";

const COMPLETE_METADATA = {
  article6Basis: "legitimate interests",
  article9Condition: "explicit consent",
  controllerJurisdiction: "United Kingdom",
  description: "Acme is an identity-platform demo organization.",
  legalControllerName: "Acme Ltd",
  privacyPolicyUrl: "https://acme.example/privacy",
  supportEmail: "support@acme.example",
  termsOfServiceUrl: "https://acme.example/terms",
  usesKayleForConsequentialDecisions: false,
  website: "https://acme.example",
} as const;

describe("getOrganizationBusinessDetailsStatus", () => {
  test("complete when all four fields are non-empty", () => {
    const status = getOrganizationBusinessDetailsStatus({
      businessType: "business",
      businessName: "Acme Ltd",
      businessJurisdiction: "United Kingdom",
      businessRegistrationNumber: "12345678",
    });
    expect(status.complete).toBe(true);
    expect(status.missingFields).toEqual([]);
  });

  test("flags missing fields", () => {
    const status = getOrganizationBusinessDetailsStatus({
      businessType: null,
      businessName: "  ",
      businessJurisdiction: "United Kingdom",
      businessRegistrationNumber: null,
    });
    expect(status.complete).toBe(false);
    expect(status.missingFields).toEqual([
      "businessType",
      "businessName",
      "businessRegistrationNumber",
    ]);
  });
});

describe("getOrganizationPublicDetailsStatus", () => {
  test("complete when logo + all four metadata fields are present", () => {
    const status = getOrganizationPublicDetailsStatus({
      logo: "https://cdn.example/logo.png",
      metadata: COMPLETE_METADATA,
    });
    expect(status.complete).toBe(true);
    expect(status.missingFields).toEqual([]);
  });

  test("flags every missing public field", () => {
    const status = getOrganizationPublicDetailsStatus({
      logo: null,
      metadata: null,
    });
    expect(status.complete).toBe(false);
    expect(status.missingFields).toEqual([
      "logo",
      "website",
      "description",
      "privacyPolicyUrl",
      "termsOfServiceUrl",
    ]);
  });
});

describe("getOrganizationOnboardingStatus", () => {
  test("complete when all four steps pass", () => {
    const status = getOrganizationOnboardingStatus({
      businessType: "business",
      businessName: "Acme Ltd",
      businessJurisdiction: "United Kingdom",
      businessRegistrationNumber: "12345678",
      logo: "https://cdn.example/logo.png",
      metadata: COMPLETE_METADATA,
      rpTermsAccepted: true,
      ownerIdCheckedAt: new Date(),
    });
    expect(status.complete).toBe(true);
    expect(status.steps.map((s) => s.id)).toEqual([
      "business",
      "public",
      "compliance",
      "owner_id",
    ]);
    expect(status.steps.every((s) => s.complete)).toBe(true);
  });

  test("compliance step requires RP terms acceptance", () => {
    const status = getOrganizationOnboardingStatus({
      businessType: "business",
      businessName: "Acme Ltd",
      businessJurisdiction: "United Kingdom",
      businessRegistrationNumber: "12345678",
      logo: "https://cdn.example/logo.png",
      metadata: COMPLETE_METADATA,
      rpTermsAccepted: false,
      ownerIdCheckedAt: new Date(),
    });
    const compliance = status.steps.find((s) => s.id === "compliance");
    expect(compliance?.complete).toBe(false);
    expect(compliance?.missingFields).toContain("rpIntegrationTermsAcceptance");
    expect(status.complete).toBe(false);
  });

  test("consequential-use=true requires fallback + appeal URLs", () => {
    const status = getOrganizationOnboardingStatus({
      businessType: "business",
      businessName: "Acme Ltd",
      businessJurisdiction: "United Kingdom",
      businessRegistrationNumber: "12345678",
      logo: "https://cdn.example/logo.png",
      metadata: {
        ...COMPLETE_METADATA,
        usesKayleForConsequentialDecisions: true,
      },
      rpTermsAccepted: true,
      ownerIdCheckedAt: new Date(),
    });
    const compliance = status.steps.find((s) => s.id === "compliance");
    expect(compliance?.complete).toBe(false);
    expect(compliance?.missingFields).toContain("fallbackIdvUrl");
    expect(compliance?.missingFields).toContain("appealUrl");
  });

  test("owner_id step incomplete when ownerIdCheckedAt is null", () => {
    const status = getOrganizationOnboardingStatus({
      businessType: "business",
      businessName: "Acme Ltd",
      businessJurisdiction: "United Kingdom",
      businessRegistrationNumber: "12345678",
      logo: "https://cdn.example/logo.png",
      metadata: COMPLETE_METADATA,
      rpTermsAccepted: true,
      ownerIdCheckedAt: null,
    });
    const ownerId = status.steps.find((s) => s.id === "owner_id");
    expect(ownerId?.complete).toBe(false);
    expect(ownerId?.missingFields).toEqual(["ownerIdCheck"]);
    expect(status.complete).toBe(false);
  });

  test("brand-new org reports every step as incomplete", () => {
    const status = getOrganizationOnboardingStatus({
      businessType: null,
      businessName: null,
      businessJurisdiction: null,
      businessRegistrationNumber: null,
      logo: null,
      metadata: null,
      rpTermsAccepted: false,
      ownerIdCheckedAt: null,
    });
    expect(status.complete).toBe(false);
    expect(status.steps.every((s) => !s.complete)).toBe(true);
  });
});
