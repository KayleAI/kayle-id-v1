import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PublicOrganizationsSearchPage } from "@/app/organizations/public/page";
import { searchPublicOrganizationsForRoute } from "@/lib/api/public-organizations-route";

interface OrganizationsSearch {
	page?: number;
	query?: string;
}

function parsePageSearchParam(value: unknown): number | undefined {
	const page = typeof value === "number" ? value : Number(value);
	return Number.isInteger(page) && page > 1 ? page : undefined;
}

function parseOrganizationsSearch(
	search: Record<string, unknown>,
): OrganizationsSearch {
	const query = typeof search.query === "string" ? search.query.trim() : "";
	const page = parsePageSearchParam(search.page);

	return {
		...(page ? { page } : {}),
		...(query ? { query } : {}),
	};
}

export const Route = createFileRoute("/organizations/")({
	component: PublicOrganizationsIndexRoute,
	validateSearch: parseOrganizationsSearch,
	loaderDeps: ({ search }) => ({
		page: search.page ?? 1,
		query: search.query ?? "",
	}),
	loader: async ({ deps }) =>
		searchPublicOrganizationsForRoute({
			data: { page: deps.page, query: deps.query },
		}),
});

function PublicOrganizationsIndexRoute() {
	const search = Route.useSearch();
	const loaderData = Route.useLoaderData();
	const navigate = useNavigate({ from: "/organizations/" });

	return (
		<PublicOrganizationsSearchPage
			error={loaderData.error}
			onSearch={(query) => {
				void navigate({
					search: query ? { query } : {},
				});
			}}
			organizations={loaderData.organizations}
			pagination={loaderData.pagination}
			query={search.query ?? ""}
		/>
	);
}
