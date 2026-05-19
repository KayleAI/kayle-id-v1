import { createFileRoute } from "@tanstack/react-router";
import { AdminOrganizationReportDetailPage } from "@/app/admin/organization-reports";

export const Route = createFileRoute(
	"/_app/admin/organization-reports/$report",
)({
	component: AdminOrganizationReportDetailRoute,
});

function AdminOrganizationReportDetailRoute() {
	const { report } = Route.useParams();

	return <AdminOrganizationReportDetailPage reportId={report} />;
}
