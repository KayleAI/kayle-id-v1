import {
	ORGANIZATION_REPORT_REASONS,
	ORGANIZATION_REPORT_STATUSES,
	type OrganizationReportReason,
	type OrganizationReportStatus,
} from "@kayle-id/config/organization-reports";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	type AdminOrganizationReportsFilters,
	AdminOrganizationReportsPage,
} from "@/app/admin/organization-reports";

type ReportFilter<T extends string> = "all" | T;

interface OrganizationReportsSearch {
	query?: string;
	reason?: ReportFilter<OrganizationReportReason>;
	status?: ReportFilter<OrganizationReportStatus>;
}

const REPORT_SEARCH_MAX_LENGTH = 120;

function parseQuerySearchParam(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const query = value.trim().slice(0, REPORT_SEARCH_MAX_LENGTH);
	return query.length > 0 ? query : undefined;
}

function parseReasonSearchParam(
	value: unknown,
): ReportFilter<OrganizationReportReason> | undefined {
	if (value === "all") {
		return "all";
	}
	return typeof value === "string" &&
		ORGANIZATION_REPORT_REASONS.includes(value as OrganizationReportReason)
		? (value as OrganizationReportReason)
		: undefined;
}

function parseStatusSearchParam(
	value: unknown,
): ReportFilter<OrganizationReportStatus> | undefined {
	if (value === "all") {
		return "all";
	}
	return typeof value === "string" &&
		ORGANIZATION_REPORT_STATUSES.includes(value as OrganizationReportStatus)
		? (value as OrganizationReportStatus)
		: undefined;
}

function parseOrganizationReportsSearch(
	search: Record<string, unknown>,
): OrganizationReportsSearch {
	const query = parseQuerySearchParam(search.query);
	const reason = parseReasonSearchParam(search.reason);
	const status = parseStatusSearchParam(search.status);

	return {
		...(query ? { query } : {}),
		...(reason ? { reason } : {}),
		...(status ? { status } : {}),
	};
}

function serializeOrganizationReportFilters({
	query,
	reason,
	status,
}: AdminOrganizationReportsFilters): OrganizationReportsSearch {
	const trimmedQuery = query.trim().slice(0, REPORT_SEARCH_MAX_LENGTH);

	return {
		...(trimmedQuery ? { query: trimmedQuery } : {}),
		...(reason === "all" ? {} : { reason }),
		...(status === "open" ? {} : { status }),
	};
}

export const Route = createFileRoute("/_app/admin/organization-reports/")({
	component: AdminOrganizationReportsRoute,
	validateSearch: parseOrganizationReportsSearch,
});

function AdminOrganizationReportsRoute() {
	const navigate = useNavigate({ from: "/admin/organization-reports/" });
	const search = Route.useSearch();

	return (
		<AdminOrganizationReportsPage
			onFiltersChange={(filters) => {
				void navigate({
					replace: true,
					search: serializeOrganizationReportFilters(filters),
				});
			}}
			query={search.query ?? ""}
			reason={search.reason ?? "all"}
			status={search.status ?? "open"}
		/>
	);
}
