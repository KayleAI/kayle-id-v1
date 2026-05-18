/**
 * Onboarding completeness predicates for an organization. A fully-onboarded
 * org has all four steps green: business details, public details, compliance
 * profile (incl. accepted RP terms), and owner identity check. Used by both
 * the platform UI (to drive the /onboarding wizard + banner) and the API
 * (to gate session creation).
 */

import type { OrganizationBusinessType } from "./organization-business-details";
import {
  getOrganizationComplianceProfileStatus,
  type OrganizationMetadata,
} from "./organization-metadata";

export type OnboardingStepId =
  | "business"
  | "public"
  | "compliance"
  | "owner_id";

export interface OnboardingStepStatus {
  complete: boolean;
  id: OnboardingStepId;
  missingFields: string[];
}

export interface OrganizationBusinessDetailsInput {
  businessJurisdiction: string | null | undefined;
  businessName: string | null | undefined;
  businessRegistrationNumber: string | null | undefined;
  businessType: OrganizationBusinessType | null | undefined;
}

export interface OrganizationBusinessDetailsStatus {
  complete: boolean;
  missingFields: string[];
}

export function getOrganizationBusinessDetailsStatus(
  input: OrganizationBusinessDetailsInput
): OrganizationBusinessDetailsStatus {
  const missingFields: string[] = [];

  if (!(input.businessType === "sole" || input.businessType === "business")) {
    missingFields.push("businessType");
  }
  if (!isNonEmptyString(input.businessName)) {
    missingFields.push("businessName");
  }
  if (!isNonEmptyString(input.businessJurisdiction)) {
    missingFields.push("businessJurisdiction");
  }
  if (!isNonEmptyString(input.businessRegistrationNumber)) {
    missingFields.push("businessRegistrationNumber");
  }

  return { complete: missingFields.length === 0, missingFields };
}

export interface OrganizationPublicDetailsInput {
  logo: string | null | undefined;
  metadata: OrganizationMetadata | null | undefined;
}

export interface OrganizationPublicDetailsStatus {
  complete: boolean;
  missingFields: string[];
}

export function getOrganizationPublicDetailsStatus(
  input: OrganizationPublicDetailsInput
): OrganizationPublicDetailsStatus {
  const missingFields: string[] = [];

  if (!isNonEmptyString(input.logo)) {
    missingFields.push("logo");
  }
  if (!isNonEmptyString(input.metadata?.website)) {
    missingFields.push("website");
  }
  if (!isNonEmptyString(input.metadata?.description)) {
    missingFields.push("description");
  }
  if (!isNonEmptyString(input.metadata?.privacyPolicyUrl)) {
    missingFields.push("privacyPolicyUrl");
  }
  if (!isNonEmptyString(input.metadata?.termsOfServiceUrl)) {
    missingFields.push("termsOfServiceUrl");
  }

  return { complete: missingFields.length === 0, missingFields };
}

export interface OrganizationOnboardingInput {
  businessJurisdiction: string | null | undefined;
  businessName: string | null | undefined;
  businessRegistrationNumber: string | null | undefined;
  businessType: OrganizationBusinessType | null | undefined;
  logo: string | null | undefined;
  metadata: OrganizationMetadata | null | undefined;
  ownerIdCheckedAt: Date | string | null | undefined;
  rpTermsAccepted: boolean;
}

export interface OrganizationOnboardingStatus {
  complete: boolean;
  steps: OnboardingStepStatus[];
}

export function getOrganizationOnboardingStatus(
  input: OrganizationOnboardingInput
): OrganizationOnboardingStatus {
  const business = getOrganizationBusinessDetailsStatus(input);
  const publicDetails = getOrganizationPublicDetailsStatus(input);
  const complianceProfile = getOrganizationComplianceProfileStatus(
    input.metadata
  );
  const complianceMissing = [...complianceProfile.missingFields];
  if (!input.rpTermsAccepted) {
    complianceMissing.push("rpIntegrationTermsAcceptance");
  }
  const ownerIdComplete = Boolean(input.ownerIdCheckedAt);

  const steps: OnboardingStepStatus[] = [
    {
      id: "business",
      complete: business.complete,
      missingFields: business.missingFields,
    },
    {
      id: "public",
      complete: publicDetails.complete,
      missingFields: publicDetails.missingFields,
    },
    {
      id: "compliance",
      complete: complianceProfile.complete && input.rpTermsAccepted,
      missingFields: complianceMissing,
    },
    {
      id: "owner_id",
      complete: ownerIdComplete,
      missingFields: ownerIdComplete ? [] : ["ownerIdCheck"],
    },
  ];

  return {
    complete: steps.every((s) => s.complete),
    steps,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
