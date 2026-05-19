import { logEvent } from "@kayle-id/config/logging";
import {
	ORGANIZATION_REPORT_REASONS,
	type OrganizationReportReason,
} from "@kayle-id/config/organization-reports";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { organization_reports } from "@kayle-id/database/schema/organization-reports";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getRequestLogger } from "@/logging";
import { sessionIdSchema } from "@/shared/validation";
import { generateId } from "@/utils/generate-id";
import { isPublicVerifySessionHidden } from "./public-session-visibility";

const organizationReports = new Hono<{ Bindings: CloudflareBindings }>();

const DETAILS_MAX_LENGTH = 2000;
const HEADER_MAX_LENGTH = 500;

const reportBodySchema = z.object({
	organization_id: z.string().uuid(),
	session_id: sessionIdSchema.nullish(),
	reason: z.enum(ORGANIZATION_REPORT_REASONS),
	details: z.string().max(DETAILS_MAX_LENGTH).nullish(),
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
		status: 400 | 404 | 500;
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

function readBoundedHeader(c: Context, name: string): string | null {
	const value = c.req.header(name);
	if (!value) {
		return null;
	}
	return value.slice(0, HEADER_MAX_LENGTH);
}

function buildReporterContext({
	c,
	hasSession,
}: {
	c: Context;
	hasSession: boolean;
}): Record<string, unknown> {
	return {
		cf_country: readBoundedHeader(c, "cf-ipcountry"),
		cf_ray: readBoundedHeader(c, "cf-ray"),
		has_session: hasSession,
		source: "verify_public",
		user_agent: readBoundedHeader(c, "user-agent"),
	};
}

function normalizeDetails(value: null | string | undefined): null | string {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

organizationReports.post(
	"/organization-reports",
	validator("json", (value, c) => {
		const parsed = reportBodySchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return jsonError(c, {
			code: "INVALID_REQUEST",
			message: parsed.error.issues[0]?.message ?? "Invalid report request.",
			status: 400,
		});
	}),
	async (c) => {
		const body = c.req.valid("json");

		const [organization] = await db
			.select({ id: auth_organizations.id })
			.from(auth_organizations)
			.where(eq(auth_organizations.id, body.organization_id))
			.limit(1);

		if (!organization) {
			return jsonError(c, {
				code: "ORGANIZATION_NOT_FOUND",
				message: "The reported organization could not be found.",
				status: 404,
			});
		}

		if (body.session_id) {
			const [session] = await db
				.select({
					id: verification_sessions.id,
					organizationId: verification_sessions.organizationId,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, body.session_id))
				.limit(1);

			if (
				!session ||
				(await isPublicVerifySessionHidden(session.organizationId))
			) {
				return jsonError(c, {
					code: "SESSION_NOT_FOUND",
					message: "The verification session could not be found.",
					status: 404,
				});
			}

			if (session.organizationId !== body.organization_id) {
				return jsonError(c, {
					code: "SESSION_ORGANIZATION_MISMATCH",
					message:
						"The verification session does not belong to the reported organization.",
					status: 400,
				});
			}
		}

		const reportId = generateId({ length: 48, type: "orpt" });
		const reason = body.reason as OrganizationReportReason;
		const details = normalizeDetails(body.details);

		await db.insert(organization_reports).values({
			details,
			id: reportId,
			reason,
			reportedOrganizationId: body.organization_id,
			reporterContext: buildReporterContext({
				c,
				hasSession: Boolean(body.session_id),
			}),
			verificationSessionId: body.session_id ?? null,
		});

		logEvent(getRequestLogger(c), {
			details: {
				has_details: details !== null,
				has_session: Boolean(body.session_id),
				reason,
				report_id: reportId,
				reported_organization_id: body.organization_id,
				session_id: body.session_id ?? null,
			},
			event: "verify.organization_report.submitted",
		});

		return c.json(
			{
				data: { report_id: reportId },
				error: null,
			},
			201,
		);
	},
);

export default organizationReports;
