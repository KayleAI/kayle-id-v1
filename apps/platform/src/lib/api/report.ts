import type { OrganizationReportReason } from "@kayle-id/config/organization-reports";
import { requestApiResource } from "@/utils/api-client";
import type { PublicOrganization } from "./public-organizations";

export type { OrganizationReportReason };
export type ReportableOrganization = PublicOrganization;

export const REPORT_ORGANIZATION_SEARCH_QUERY_KEY = [
	"report",
	"organizations",
] as const;

export const REPORT_ORGANIZATION_QUERY_KEY = [
	"report",
	"organization",
] as const;

export function searchReportableOrganizations(
	query: string,
): Promise<{ organizations: ReportableOrganization[] }> {
	return requestApiResource<{ organizations: ReportableOrganization[] }>({
		basePath: "/api/report/organizations",
		method: "GET",
		query: { query },
		unexpectedMessage: "Unable to search organizations.",
	});
}

export function fetchReportableOrganization(
	identifier: string,
): Promise<{ organization: ReportableOrganization }> {
	return requestApiResource<{ organization: ReportableOrganization }>({
		basePath: "/api/report/organizations",
		method: "GET",
		path: `/${encodeURIComponent(identifier)}`,
		unexpectedMessage: "Unable to load organization.",
	});
}

export interface SubmitPublicOrganizationReportInput {
	details: string | null;
	organization_id: string;
	reason: OrganizationReportReason;
	session_id: null | string;
}

export function submitPublicOrganizationReport(
	input: SubmitPublicOrganizationReportInput,
): Promise<{ report_id: string }> {
	return requestApiResource<{ report_id: string }>({
		basePath: "/api/report/organization-reports",
		body: input,
		method: "POST",
		unexpectedMessage: "Unable to submit organization report.",
	});
}
