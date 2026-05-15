import { createFileRoute } from "@tanstack/react-router";
import { AdminCostAnalyticsPage } from "@/app/admin/cost-analytics";

export const Route = createFileRoute("/_app/admin/cost-analytics")({
	component: AdminCostAnalyticsPage,
});
