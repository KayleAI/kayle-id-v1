import { createFileRoute } from "@tanstack/react-router";
import { OrganizationDomainsPage } from "@/app/organizations/domains";

export const Route = createFileRoute("/_app/settings/organizations/domains")({
	component: OrganizationDomainsPage,
});
