import type {
	OrganizationReportReason,
	OrganizationReportStatus,
} from "@kayle-id/config/organization-reports";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { organization_reports } from "@kayle-id/database/schema/organization-reports";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

const reportSelect = {
	adminNote: organization_reports.adminNote,
	createdAt: organization_reports.createdAt,
	details: organization_reports.details,
	id: organization_reports.id,
	reason: organization_reports.reason,
	reportedOrganizationId: organization_reports.reportedOrganizationId,
	reportedOrganizationLogo: auth_organizations.logo,
	reportedOrganizationName: auth_organizations.name,
	reportedOrganizationSlug: auth_organizations.slug,
	reporterContext: organization_reports.reporterContext,
	resolvedAt: organization_reports.resolvedAt,
	resolvedByUserId: organization_reports.resolvedByUserId,
	status: organization_reports.status,
	updatedAt: organization_reports.updatedAt,
	verificationSessionId: organization_reports.verificationSessionId,
};

type OrganizationReportRow = {
	adminNote: null | string;
	createdAt: Date;
	details: null | string;
	id: string;
	reason: OrganizationReportReason;
	reportedOrganizationId: string;
	reportedOrganizationLogo: null | string;
	reportedOrganizationName: string;
	reportedOrganizationSlug: string;
	reporterContext: Record<string, unknown>;
	resolvedAt: Date | null;
	resolvedByUserId: null | string;
	status: OrganizationReportStatus;
	updatedAt: Date;
	verificationSessionId: null | string;
};

export function serializeReport(row: OrganizationReportRow) {
	return {
		admin_note: row.adminNote,
		created_at: row.createdAt.toISOString(),
		details: row.details,
		id: row.id,
		reason: row.reason,
		reported_organization: {
			id: row.reportedOrganizationId,
			logo: row.reportedOrganizationLogo,
			name: row.reportedOrganizationName,
			slug: row.reportedOrganizationSlug,
		},
		reporter_context: row.reporterContext,
		resolved_at: row.resolvedAt?.toISOString() ?? null,
		resolved_by_user_id: row.resolvedByUserId,
		status: row.status,
		updated_at: row.updatedAt.toISOString(),
		verification_session_id: row.verificationSessionId,
	};
}

export async function selectReportById(
	id: string,
): Promise<OrganizationReportRow | null> {
	const [report] = await db
		.select(reportSelect)
		.from(organization_reports)
		.innerJoin(
			auth_organizations,
			eq(auth_organizations.id, organization_reports.reportedOrganizationId),
		)
		.where(eq(organization_reports.id, id))
		.limit(1);

	return report ?? null;
}

function escapeIlikeWildcards(input: string): string {
	return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function listOrganizationReports({
	query,
	reason,
	status,
}: {
	query?: string;
	reason?: OrganizationReportReason;
	status?: OrganizationReportStatus;
}): Promise<OrganizationReportRow[]> {
	const conditions = [];
	if (status) {
		conditions.push(eq(organization_reports.status, status));
	}
	if (reason) {
		conditions.push(eq(organization_reports.reason, reason));
	}
	if (query) {
		const searchPattern = `%${escapeIlikeWildcards(query)}%`;
		conditions.push(
			or(
				ilike(organization_reports.id, searchPattern),
				ilike(organization_reports.verificationSessionId, searchPattern),
				ilike(organization_reports.details, searchPattern),
				ilike(auth_organizations.name, searchPattern),
				ilike(auth_organizations.slug, searchPattern),
				sql`${organization_reports.reportedOrganizationId}::text ILIKE ${searchPattern}`,
			),
		);
	}

	return db
		.select(reportSelect)
		.from(organization_reports)
		.innerJoin(
			auth_organizations,
			eq(auth_organizations.id, organization_reports.reportedOrganizationId),
		)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(
			desc(organization_reports.createdAt),
			desc(organization_reports.id),
		)
		.limit(100);
}

function normalizeAdminNote(value: null | string | undefined): null | string {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export async function updateOrganizationReport({
	adminNote,
	id,
	status,
	userId,
}: {
	adminNote: null | string | undefined;
	id: string;
	status: OrganizationReportStatus;
	userId: string;
}): Promise<OrganizationReportRow | null> {
	const isResolvedState = status === "resolved" || status === "dismissed";
	const now = new Date();

	const [updated] = await db
		.update(organization_reports)
		.set({
			adminNote: normalizeAdminNote(adminNote),
			resolvedAt: isResolvedState ? now : null,
			resolvedByUserId: isResolvedState ? userId : null,
			status,
			updatedAt: now,
		})
		.where(eq(organization_reports.id, id))
		.returning({ id: organization_reports.id });

	if (!updated) {
		return null;
	}

	return selectReportById(updated.id);
}
