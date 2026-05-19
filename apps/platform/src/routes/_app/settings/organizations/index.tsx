import { createFileRoute } from "@tanstack/react-router";
import { OrganizationOverviewPage } from "@/app/organizations/overview";

export const Route = createFileRoute("/_app/settings/organizations/")({
	component: OrganizationOverviewPage,
});
