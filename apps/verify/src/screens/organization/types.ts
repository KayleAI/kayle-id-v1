import type { VerifySessionDetailsPayload } from "@/api/verify-api";

export type Organization = {
	id: string;
	name: string | null;
	ownerIdCheckCompleted: boolean;
	verifiedApexDomains: string[];
	logo: string | null;
	businessType: "sole" | "business" | null;
	businessName: string | null;
	businessJurisdiction: string | null;
	businessRegistrationNumber: string | null;
	privacyPolicyUrl: string | null;
	termsOfServiceUrl: string | null;
	website: string | null;
	description: string | null;
	rpFallback: {
		appealUrl: string | null;
		complaintsUrl: string | null;
		fallbackIdvUrl: string | null;
		supportEmail: string | null;
	};
};

type OrganizationFields = Omit<
	Pick<
		VerifySessionDetailsPayload,
		| "organization_id"
		| "organization_business_jurisdiction"
		| "organization_business_name"
		| "organization_business_registration_number"
		| "organization_business_type"
		| "organization_description"
		| "organization_logo"
		| "organization_owner_id_check_completed"
		| "organization_privacy_policy_url"
		| "organization_terms_of_service_url"
		| "organization_verified_apex_domains"
		| "organization_website"
	>,
	"organization_name"
> & {
	organization_name: string | null;
	rp_fallback: VerifySessionDetailsPayload["rp_fallback"];
};

export const EMPTY_ORGANIZATION: Organization = {
	id: "",
	name: null,
	ownerIdCheckCompleted: false,
	verifiedApexDomains: [],
	logo: null,
	businessType: null,
	businessName: null,
	businessJurisdiction: null,
	businessRegistrationNumber: null,
	privacyPolicyUrl: null,
	termsOfServiceUrl: null,
	website: null,
	description: null,
	rpFallback: {
		appealUrl: null,
		complaintsUrl: null,
		fallbackIdvUrl: null,
		supportEmail: null,
	},
};

export function toOrganization(source: OrganizationFields): Organization {
	return {
		id: source.organization_id,
		name: source.organization_name,
		ownerIdCheckCompleted: source.organization_owner_id_check_completed,
		verifiedApexDomains: source.organization_verified_apex_domains,
		logo: source.organization_logo,
		businessType: source.organization_business_type,
		businessName: source.organization_business_name,
		businessJurisdiction: source.organization_business_jurisdiction,
		businessRegistrationNumber:
			source.organization_business_registration_number,
		privacyPolicyUrl: source.organization_privacy_policy_url,
		termsOfServiceUrl: source.organization_terms_of_service_url,
		website: source.organization_website,
		description: source.organization_description,
		rpFallback: {
			appealUrl: source.rp_fallback.appeal_url,
			complaintsUrl: source.rp_fallback.complaints_url,
			fallbackIdvUrl: source.rp_fallback.fallback_idv_url,
			supportEmail: source.rp_fallback.support_email,
		},
	};
}
