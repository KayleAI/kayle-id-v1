import { createFileRoute } from "@tanstack/react-router";
import { OrganizationCompliancePage } from "@/app/organizations/compliance";

export const Route = createFileRoute("/_app/organizations/compliance")({
	component: OrganizationCompliancePage,
});
