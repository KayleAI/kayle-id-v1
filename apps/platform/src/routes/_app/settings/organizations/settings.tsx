import { createFileRoute } from "@tanstack/react-router";
import { OrganizationSettingsPage } from "@/app/organizations/settings";

export const Route = createFileRoute("/_app/settings/organizations/settings")({
	component: OrganizationSettingsPage,
});
