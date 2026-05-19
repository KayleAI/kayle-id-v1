import { requestApiResource } from "@/utils/api-client";

export interface PublicOrganization {
	business_jurisdiction: string | null;
	business_name: string | null;
	business_registration_number: string | null;
	business_type: "business" | "sole" | null;
	description: string | null;
	id: string;
	integration_terms_accepted: true;
	logo: string | null;
	name: string;
	owner_id_check_completed: boolean;
	privacy_policy_url: string | null;
	rp_fallback: {
		appeal_url: string | null;
		complaints_url: string | null;
		fallback_idv_url: string | null;
		support_email: string | null;
	};
	slug: string;
	terms_of_service_url: string | null;
	verified_apex_domains: string[];
	website: string | null;
}

export interface PublicOrganizationsSearchLoaderData {
	error: null | string;
	organizations: PublicOrganization[];
	pagination: PublicOrganizationsPagination;
}

export interface PublicOrganizationDetailLoaderData {
	error: null | string;
	organization: PublicOrganization | null;
}

export interface PublicOrganizationsPagination {
	has_next_page: boolean;
	has_previous_page: boolean;
	page: number;
	page_size: number;
}

export interface PublicOrganizationsSearchResponse {
	organizations: PublicOrganization[];
	pagination: PublicOrganizationsPagination;
}

export const DEFAULT_PUBLIC_ORGANIZATIONS_PAGINATION: PublicOrganizationsPagination =
	{
		has_next_page: false,
		has_previous_page: false,
		page: 1,
		page_size: 10,
	};

export const PUBLIC_ORGANIZATION_SEARCH_QUERY_KEY = [
	"public-organizations",
	"search",
] as const;

export const PUBLIC_ORGANIZATION_QUERY_KEY = [
	"public-organizations",
	"detail",
] as const;

export async function searchPublicOrganizations(
	query: string,
	page = 1,
): Promise<PublicOrganizationsSearchResponse> {
	return requestApiResource<PublicOrganizationsSearchResponse>({
		basePath: "/api/organizations",
		method: "GET",
		query: { page: page > 1 ? page : undefined, query },
		unexpectedMessage: "Unable to search organizations.",
	});
}

export function fetchPublicOrganization(
	identifier: string,
): Promise<{ organization: PublicOrganization }> {
	return requestApiResource<{ organization: PublicOrganization }>({
		basePath: "/api/organizations",
		method: "GET",
		path: `/${encodeURIComponent(identifier)}`,
		unexpectedMessage: "Unable to load organization.",
	});
}
