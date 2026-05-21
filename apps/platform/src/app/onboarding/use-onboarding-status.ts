import { getOrganizationOnboardingStatus } from "@kayle-id/auth/organization-onboarding";
import { useQuery } from "@tanstack/react-query";
import {
	type FullOrganization,
	fetchRpIntegrationTermsStatus,
	ORGANIZATION_RP_TERMS_QUERY_KEY,
} from "@/app/organizations/api";
import { useOrganizationQuery } from "@/app/organizations/use-organization-query";

export interface UseOnboardingStatusResult {
	isLoading: boolean;
	isError: boolean;
	organization: FullOrganization | undefined;
	complete: boolean;
	rpTermsAccepted: boolean;
	steps: ReturnType<typeof getOrganizationOnboardingStatus>["steps"];
}

export function useOnboardingStatus(): UseOnboardingStatusResult {
	const organizationQuery = useOrganizationQuery();
	const rpTermsQuery = useQuery({
		queryFn: fetchRpIntegrationTermsStatus,
		queryKey: ORGANIZATION_RP_TERMS_QUERY_KEY,
		staleTime: 30_000,
	});

	const organization = organizationQuery.data;
	const rpTermsAccepted = rpTermsQuery.data?.current_accepted === true;

	const status = getOrganizationOnboardingStatus({
		businessType: organization?.businessType ?? null,
		businessName: organization?.businessName ?? null,
		businessJurisdiction: organization?.businessJurisdiction ?? null,
		businessRegistrationNumber:
			organization?.businessRegistrationNumber ?? null,
		logo: organization?.logo ?? null,
		metadata: organization?.metadata ?? null,
		rpTermsAccepted,
		ownerIdCheckedAt: organization?.verifiedAt ?? null,
	});

	return {
		isLoading: organizationQuery.isLoading || rpTermsQuery.isLoading,
		isError: organizationQuery.isError || rpTermsQuery.isError,
		organization,
		complete: status.complete,
		rpTermsAccepted,
		steps: status.steps,
	};
}
