import { createFileRoute } from "@tanstack/react-router";
import { PublicOrganizationProfilePage } from "@/app/organizations/public/page";
import { fetchPublicOrganizationForRoute } from "@/lib/api/public-organizations-route";

export const Route = createFileRoute("/organizations/$identifier/")({
	component: PublicOrganizationProfileRoute,
	loader: async ({ params }) =>
		fetchPublicOrganizationForRoute({
			data: { identifier: params.identifier },
		}),
});

function PublicOrganizationProfileRoute() {
	const loaderData = Route.useLoaderData();

	return (
		<PublicOrganizationProfilePage
			error={loaderData.error}
			organization={loaderData.organization}
		/>
	);
}
