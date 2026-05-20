import { useAuth } from "@kayle-id/auth/client/provider";
import type { OrganizationRole } from "@kayle-id/auth/types";
import { useQuery } from "@tanstack/react-query";
import {
	fetchFullOrganization,
	listOrganizationDomains,
	ORGANIZATION_DOMAINS_QUERY_KEY,
	ORGANIZATION_QUERY_KEY,
} from "./api";

const ORGANIZATION_STALE_TIME_MS = 30_000;

export function useOrganizationQuery() {
	return useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: ORGANIZATION_STALE_TIME_MS,
	});
}

export function useOrganizationDomainsQuery() {
	return useQuery({
		queryFn: listOrganizationDomains,
		queryKey: ORGANIZATION_DOMAINS_QUERY_KEY,
		staleTime: ORGANIZATION_STALE_TIME_MS,
	});
}

export function useCurrentMemberRole(): OrganizationRole | undefined {
	const { user } = useAuth();
	const { data } = useOrganizationQuery();
	return data?.members.find((member) => member.userId === user?.id)?.role as
		| OrganizationRole
		| undefined;
}
