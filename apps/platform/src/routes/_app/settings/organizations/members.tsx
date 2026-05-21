import { createFileRoute } from "@tanstack/react-router";
import { OrganizationMembersPage } from "@/app/organizations/members";

export const Route = createFileRoute("/_app/settings/organizations/members")({
	component: OrganizationMembersPage,
});
