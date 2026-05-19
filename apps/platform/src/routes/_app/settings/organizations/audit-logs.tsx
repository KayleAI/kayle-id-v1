import { createFileRoute } from "@tanstack/react-router";
import { OrganizationAuditLogsPage } from "@/app/organizations/audit-logs";

export const Route = createFileRoute("/_app/settings/organizations/audit-logs")(
	{
		component: OrganizationAuditLogsPage,
	},
);
