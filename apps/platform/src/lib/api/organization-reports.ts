import type {
	OrganizationReportReason,
	OrganizationReportStatus,
} from "@kayle-id/config/organization-reports";
import { requestApiResource } from "@/utils/api-client";

export type { OrganizationReportReason, OrganizationReportStatus };

export interface OrganizationReport {
	admin_note: string | null;
	created_at: string;
	details: string | null;
	id: string;
	reason: OrganizationReportReason;
	reported_organization: {
		id: string;
		logo: string | null;
		name: string;
		slug: string;
	};
	reporter_context: Record<string, unknown>;
	resolved_at: string | null;
	resolved_by_user_id: string | null;
	status: OrganizationReportStatus;
	updated_at: string;
	verification_session_id: string | null;
}

export const ORGANIZATION_REPORTS_QUERY_KEY = [
	"admin",
	"organization-reports",
] as const;

export const ORGANIZATION_REPORT_QUERY_KEY = [
	"admin",
	"organization-report",
] as const;

export function fetchOrganizationReports(params: {
	query?: string;
	reason?: "all" | OrganizationReportReason;
	status?: "all" | OrganizationReportStatus;
}): Promise<{ reports: OrganizationReport[] }> {
	return requestApiResource<{ reports: OrganizationReport[] }>({
		basePath: "/api/admin/organization-reports",
		method: "GET",
		query: {
			query: params.query,
			reason: params.reason,
			status: params.status,
		},
		unexpectedMessage: "Unable to load organization reports.",
	});
}

export function fetchOrganizationReport(
	id: string,
): Promise<{ report: OrganizationReport }> {
	return requestApiResource<{ report: OrganizationReport }>({
		basePath: "/api/admin/organization-reports",
		method: "GET",
		path: `/${encodeURIComponent(id)}`,
		unexpectedMessage: "Unable to load organization report.",
	});
}

export function updateOrganizationReport(input: {
	admin_note: string | null;
	id: string;
	status: OrganizationReportStatus;
}): Promise<{ report: OrganizationReport }> {
	return requestApiResource<{ report: OrganizationReport }>({
		basePath: "/api/admin/organization-reports",
		body: {
			admin_note: input.admin_note,
			status: input.status,
		},
		method: "PATCH",
		path: `/${encodeURIComponent(input.id)}`,
		unexpectedMessage: "Unable to update organization report.",
	});
}
