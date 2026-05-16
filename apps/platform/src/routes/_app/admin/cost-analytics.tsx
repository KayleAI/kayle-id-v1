import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AdminCostAnalyticsPage } from "@/app/admin/cost-analytics";

const costAnalyticsSearchSchema = z.object({
	from: z.string().datetime().optional(),
});

export const Route = createFileRoute("/_app/admin/cost-analytics")({
	component: AdminCostAnalyticsRoute,
	validateSearch: costAnalyticsSearchSchema,
});

function AdminCostAnalyticsRoute() {
	const navigate = useNavigate();
	const search = Route.useSearch();

	return (
		<AdminCostAnalyticsPage
			onTrackingFromChange={(from) => {
				navigate({
					replace: true,
					search: { from },
					to: "/admin/cost-analytics",
				});
			}}
			trackingFrom={search.from}
		/>
	);
}
