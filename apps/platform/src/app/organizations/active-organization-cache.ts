import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { API_KEYS_QUERY_KEY } from "@/app/api-keys/api";
import { SESSION_ANALYTICS_OVERVIEW_QUERY_KEY } from "@/app/dashboard/api";
import { WEBHOOKS_QUERY_KEY } from "@/app/webhooks/api";
import { ORGANIZATION_QUERY_KEY } from "./api";

const ACTIVE_ORGANIZATION_QUERY_KEYS = [
	ORGANIZATION_QUERY_KEY,
	API_KEYS_QUERY_KEY,
	WEBHOOKS_QUERY_KEY,
	SESSION_ANALYTICS_OVERVIEW_QUERY_KEY,
] as const satisfies readonly QueryKey[];

export async function resetActiveOrganizationQueries(
	queryClient: QueryClient,
): Promise<void> {
	await Promise.all(
		ACTIVE_ORGANIZATION_QUERY_KEYS.map((queryKey) =>
			queryClient.resetQueries({ queryKey }),
		),
	);
}
