import {
	ORGANIZATION_REPORT_REASONS,
	ORGANIZATION_REPORT_STATUSES,
	type OrganizationReportReason,
	type OrganizationReportStatus,
} from "@kayle-id/config/organization-reports";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { organization_reports } from "@kayle-id/database/schema/organization-reports";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";

type AdminContextVariables = {
	userId: string;
	organizationId: string;
};

const organizationReports = new Hono<{
	Bindings: CloudflareBindings;
	Variables: AdminContextVariables;
}>();

const REPORT_ID_PATTERN = /^orpt_[a-zA-Z0-9_-]+$/u;
const ADMIN_NOTE_MAX_LENGTH = 2000;
const REPORT_SEARCH_MAX_LENGTH = 120;

const querySchema = z.object({
	query: z
		.string()
		.trim()
		.max(REPORT_SEARCH_MAX_LENGTH)
		.optional()
		.transform((value) => (value && value.length > 0 ? value : undefined)),
	reason: z.enum(ORGANIZATION_REPORT_REASONS).optional(),
	status: z.enum(ORGANIZATION_REPORT_STATUSES).optional(),
});

const updateParamSchema = z.object({
	id: z.string().regex(REPORT_ID_PATTERN),
});

const updateBodySchema = z.object({
	admin_note: z.string().max(ADMIN_NOTE_MAX_LENGTH).nullish(),
	status: z.enum(ORGANIZATION_REPORT_STATUSES),
});

function jsonError(
	c: Context,
	{
		code,
		message,
		status,
	}: {
		code: string;
		message: string;
		status: 400 | 404;
	},
) {
	return c.json(
		{
			data: null,
			error: { code, message },
		},
		status,
	);
}

function normalizeAdminNote(value: null | string | undefined): null | string {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

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

function serializeReport(row: OrganizationReportRow) {
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

async function selectReportById(
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

organizationReports.get("/organization-reports", async (c) => {
	const parsed = querySchema.safeParse({
		query: c.req.query("query"),
		reason: c.req.query("reason"),
		status: c.req.query("status"),
	});
	if (!parsed.success) {
		return jsonError(c, {
			code: "INVALID_QUERY",
			message: parsed.error.issues[0]?.message ?? "Invalid query.",
			status: 400,
		});
	}

	const conditions = [];
	if (parsed.data.status) {
		conditions.push(
			eq(
				organization_reports.status,
				parsed.data.status as OrganizationReportStatus,
			),
		);
	}
	if (parsed.data.reason) {
		conditions.push(
			eq(
				organization_reports.reason,
				parsed.data.reason as OrganizationReportReason,
			),
		);
	}
	if (parsed.data.query) {
		const searchPattern = `%${escapeIlikeWildcards(parsed.data.query)}%`;
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

	const rows = await db
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

	return c.json({
		data: { reports: rows.map(serializeReport) },
		error: null,
	});
});

organizationReports.get(
	"/organization-reports/:id",
	validator("param", (value, c) => {
		const parsed = updateParamSchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return jsonError(c, {
			code: "INVALID_REPORT_ID",
			message: "Invalid report ID.",
			status: 400,
		});
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const report = await selectReportById(id);

		if (!report) {
			return jsonError(c, {
				code: "REPORT_NOT_FOUND",
				message: "The organization report could not be found.",
				status: 404,
			});
		}

		return c.json({
			data: { report: serializeReport(report) },
			error: null,
		});
	},
);

organizationReports.patch(
	"/organization-reports/:id",
	validator("param", (value, c) => {
		const parsed = updateParamSchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return jsonError(c, {
			code: "INVALID_REPORT_ID",
			message: "Invalid report ID.",
			status: 400,
		});
	}),
	validator("json", (value, c) => {
		const parsed = updateBodySchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return jsonError(c, {
			code: "INVALID_REQUEST",
			message: parsed.error.issues[0]?.message ?? "Invalid update request.",
			status: 400,
		});
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const nextStatus = body.status as OrganizationReportStatus;
		const isResolvedState =
			nextStatus === "resolved" || nextStatus === "dismissed";
		const now = new Date();

		const [updated] = await db
			.update(organization_reports)
			.set({
				adminNote: normalizeAdminNote(body.admin_note),
				resolvedAt: isResolvedState ? now : null,
				resolvedByUserId: isResolvedState ? c.get("userId") : null,
				status: nextStatus,
				updatedAt: now,
			})
			.where(eq(organization_reports.id, id))
			.returning({ id: organization_reports.id });

		if (!updated) {
			return jsonError(c, {
				code: "REPORT_NOT_FOUND",
				message: "The organization report could not be found.",
				status: 404,
			});
		}

		const report = await selectReportById(updated.id);
		if (!report) {
			return jsonError(c, {
				code: "REPORT_NOT_FOUND",
				message: "The organization report could not be found.",
				status: 404,
			});
		}

		return c.json({
			data: { report: serializeReport(report) },
			error: null,
		});
	},
);

export default organizationReports;
