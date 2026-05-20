import { createFileRoute } from "@tanstack/react-router";
import { ReportOrganizationPage } from "@/app/organizations/public/report";
import { parseReportRouteSearch } from "@/app/organizations/public/report-search-params";
import { fetchReportableOrganizationForRoute } from "@/lib/api/public-organizations-route";

export const Route = createFileRoute(
	"/_marketing/organizations/$identifier/report",
)({
	component: ReportOrganizationRoute,
	validateSearch: parseReportRouteSearch,
	loader: async ({ params }) =>
		fetchReportableOrganizationForRoute({
			data: { identifier: params.identifier },
		}),
});

function ReportOrganizationRoute() {
	const loaderData = Route.useLoaderData();
	const search = Route.useSearch();

	return (
		<ReportOrganizationPage
			error={loaderData.error}
			organization={loaderData.organization}
			sessionId={search.session_id ?? null}
		/>
	);
}
