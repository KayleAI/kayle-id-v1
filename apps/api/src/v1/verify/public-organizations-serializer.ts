import { parseStoredOrganizationMetadata } from "@kayle-id/auth/organization-metadata";
import type { PublicOrganizationRow } from "./public-organizations-types";

export function serializePublicOrganization(
	organization: PublicOrganizationRow,
	domainsByOrganizationId: Map<string, string[]>,
) {
	const verifiedApexDomains =
		domainsByOrganizationId.get(organization.id) ?? [];
	const metadata = parseStoredOrganizationMetadata(organization.metadata);
	const businessFieldsAllowed = verifiedApexDomains.length > 0;

	return {
		business_jurisdiction: businessFieldsAllowed
			? organization.businessJurisdiction
			: null,
		business_name: businessFieldsAllowed ? organization.businessName : null,
		business_registration_number: businessFieldsAllowed
			? organization.businessRegistrationNumber
			: null,
		business_type: businessFieldsAllowed ? organization.businessType : null,
		description: metadata?.description ?? null,
		id: organization.id,
		integration_terms_accepted: true,
		logo: businessFieldsAllowed ? organization.logo : null,
		name: organization.name,
		owner_id_check_completed: organization.ownerIdCheckedAt !== null,
		privacy_policy_url: metadata?.privacyPolicyUrl ?? null,
		rp_fallback: {
			appeal_url: metadata?.appealUrl ?? null,
			complaints_url: metadata?.complaintsUrl ?? null,
			fallback_idv_url: metadata?.fallbackIdvUrl ?? null,
			support_email: metadata?.supportEmail ?? null,
		},
		slug: organization.slug,
		terms_of_service_url: metadata?.termsOfServiceUrl ?? null,
		verified_apex_domains: verifiedApexDomains,
		website: metadata?.website ?? null,
	};
}
