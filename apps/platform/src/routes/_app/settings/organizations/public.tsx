import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPublicDetailsPage } from "@/app/organizations/public-details";

export const Route = createFileRoute("/_app/settings/organizations/public")({
	component: OrganizationPublicDetailsPage,
});
