import { requestApiResource } from "@/utils/api-client";

const ACCOUNT_PATH = "/api/auth/account";

const UNEXPECTED_ACCOUNT_RESPONSE = "Unexpected account response.";

export interface OwnedOrganization {
	id: string;
	name: string;
	slug: string;
}

interface OwnedOrganizationsResult {
	organizations: OwnedOrganization[];
}

export const OWNED_ORGS_QUERY_KEY = ["account", "owned-organizations"] as const;

export function listOwnedOrganizations(): Promise<OwnedOrganization[]> {
	return requestApiResource<OwnedOrganizationsResult>({
		basePath: ACCOUNT_PATH,
		path: "/owned-organizations",
		unexpectedMessage: UNEXPECTED_ACCOUNT_RESPONSE,
	}).then((result) => result.organizations);
}
