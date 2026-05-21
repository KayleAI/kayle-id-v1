import { parseStoredOrganizationMetadata } from "@kayle-id/auth/organization-metadata";
import {
	getOrganizationOnboardingStatus,
	type OnboardingStepId,
} from "@kayle-id/auth/organization-onboarding";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_rp_terms_acceptances,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";

export type OrganizationOnboardingGateResult =
	| { ok: true }
	| {
			ok: false;
			missingSteps: OnboardingStepId[];
			missingFields: string[];
			/**
			 * `terms_not_accepted` is surfaced separately so the API can route to
			 * the long-standing "accept the current Kayle ID Integration Terms"
			 * copy. Every other shape of incompleteness maps to
			 * `onboarding_incomplete`.
			 */
			reason: "onboarding_incomplete" | "terms_not_accepted";
	  };

export async function checkOrganizationOnboardingGate({
	organizationId,
}: {
	organizationId: string;
}): Promise<OrganizationOnboardingGateResult> {
	const [organization] = await db
		.select({
			businessJurisdiction: auth_organizations.business_jurisdiction,
			businessName: auth_organizations.business_name,
			businessRegistrationNumber:
				auth_organizations.business_registration_number,
			businessType: auth_organizations.business_type,
			logo: auth_organizations.logo,
			metadata: auth_organizations.metadata,
			ownerIdCheckedAt: auth_organizations.owner_id_checked_at,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);

	const [currentTermsAcceptance] = await db
		.select({ id: auth_organization_rp_terms_acceptances.id })
		.from(auth_organization_rp_terms_acceptances)
		.where(
			and(
				eq(
					auth_organization_rp_terms_acceptances.organizationId,
					organizationId,
				),
				eq(
					auth_organization_rp_terms_acceptances.termsVersion,
					RP_INTEGRATION_TERMS_VERSION,
				),
				eq(
					auth_organization_rp_terms_acceptances.termsHash,
					RP_INTEGRATION_TERMS_HASH,
				),
				eq(
					auth_organization_rp_terms_acceptances.jurisdiction,
					RP_INTEGRATION_TERMS_JURISDICTION,
				),
			),
		)
		.limit(1);

	const metadata = parseStoredOrganizationMetadata(organization?.metadata);
	const status = getOrganizationOnboardingStatus({
		businessType: organization?.businessType ?? null,
		businessName: organization?.businessName ?? null,
		businessJurisdiction: organization?.businessJurisdiction ?? null,
		businessRegistrationNumber:
			organization?.businessRegistrationNumber ?? null,
		logo: organization?.logo ?? null,
		metadata,
		rpTermsAccepted: Boolean(currentTermsAcceptance),
		ownerIdCheckedAt: organization?.ownerIdCheckedAt ?? null,
	});

	if (status.complete) {
		return { ok: true };
	}

	const missingSteps = status.steps
		.filter((step) => !step.complete)
		.map((step) => step.id);
	const missingFields = status.steps.flatMap((step) => step.missingFields);

	// Preserve the long-standing "RP_TERMS_ACCEPTANCE_REQUIRED" copy when terms
	// acceptance is the *only* outstanding item — the platform still hands users
	// to the dedicated dialog for that case.
	const onlyMissingTerms =
		missingSteps.length === 1 &&
		missingSteps[0] === "compliance" &&
		missingFields.length === 1 &&
		missingFields[0] === "rpIntegrationTermsAcceptance";

	return {
		ok: false,
		missingSteps,
		missingFields,
		reason: onlyMissingTerms ? "terms_not_accepted" : "onboarding_incomplete",
	};
}
