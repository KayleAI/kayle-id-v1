import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { API_KEYS_QUERY_KEY } from "@/app/api-keys/api";
import { SESSION_ANALYTICS_OVERVIEW_QUERY_KEY } from "@/app/dashboard/api";
import { WEBHOOKS_QUERY_KEY } from "@/app/webhooks/api";
import { resetActiveOrganizationQueries } from "./active-organization-cache";
import { ORGANIZATION_QUERY_KEY } from "./api";

test("resetActiveOrganizationQueries clears active organization scoped caches", async () => {
	const queryClient = new QueryClient();

	queryClient.setQueryData(ORGANIZATION_QUERY_KEY, { id: "org-old" });
	queryClient.setQueryData([...ORGANIZATION_QUERY_KEY, "domains"], {
		domains: ["old.example"],
	});
	queryClient.setQueryData(API_KEYS_QUERY_KEY, { data: ["old-key"] });
	queryClient.setQueryData([...WEBHOOKS_QUERY_KEY, "events", "list"], {
		pages: [{ data: ["old-event"] }],
	});
	queryClient.setQueryData(SESSION_ANALYTICS_OVERVIEW_QUERY_KEY, {
		summary: { total: 42 },
	});
	queryClient.setQueryData(["passkeys"], ["keep"]);

	await resetActiveOrganizationQueries(queryClient);

	expect(queryClient.getQueryData(ORGANIZATION_QUERY_KEY)).toBeUndefined();
	expect(
		queryClient.getQueryData([...ORGANIZATION_QUERY_KEY, "domains"]),
	).toBeUndefined();
	expect(queryClient.getQueryData(API_KEYS_QUERY_KEY)).toBeUndefined();
	expect(
		queryClient.getQueryData([...WEBHOOKS_QUERY_KEY, "events", "list"]),
	).toBeUndefined();
	expect(
		queryClient.getQueryData(SESSION_ANALYTICS_OVERVIEW_QUERY_KEY),
	).toBeUndefined();
	expect(queryClient.getQueryData(["passkeys"])).toEqual(["keep"]);
});
