import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { orgVerificationDocumentTypes } from "@kayle-id/database/schema/core";
import { and, eq, isNull } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import { ErrorResponse } from "@/openapi/base";
import { InternalServerErrorResponse } from "@/openapi/errors";
import { recordOrgVerification } from "./records-repo";

const docs = "https://kayle.id/docs/api/internal/org-verification";

const finalizeOrgVerificationRoute = createRoute({
	hide: true,
	method: "post",
	path: "/finalize",
	tags: ["Internal"],
	summary:
		"Finalize an organization verification: write the dedup hash row and flip the org's `verified_at`.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organization_id: z.string().uuid(),
						document_type: z.enum(orgVerificationDocumentTypes),
						document_number: z.string().min(1),
						issuing_country: z.string().length(3),
					}),
				},
			},
			required: true,
		},
	},
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							verified_at: z.string(),
							record_id: z.string().nullable(),
							dedup_hash: z.string().nullable(),
							pepper_version: z.number().nullable(),
							already_verified: z.boolean(),
						}),
						error: z.null(),
					}),
				},
			},
			description:
				"Finalization recorded. `already_verified=true` if the org was already verified before this call.",
		},
		400: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Bad request.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Trust token missing or invalid.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Target organization does not exist.",
		},
		500: {
			content: { "application/json": { schema: InternalServerErrorResponse } },
			description: "Internal server error.",
		},
	},
});

const finalize = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

finalize.openapi(finalizeOrgVerificationRoute, async (c) => {
	const log = getRequestLogger(c);
	const body = c.req.valid("json");

	const [org] = await db
		.select({
			id: auth_organizations.id,
			verifiedAt: auth_organizations.verified_at,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, body.organization_id))
		.limit(1);

	if (!org) {
		return c.json(
			{
				data: null,
				error: {
					code: "ORGANIZATION_NOT_FOUND" as const,
					message: "Organization not found.",
					hint: "Provide an existing organization ID.",
					docs,
				},
			},
			404,
		);
	}

	if (org.verifiedAt) {
		logEvent(log, {
			details: { organization_id: org.id, already_verified: true },
			event: "org_verifications.finalize.idempotent",
		});
		return c.json(
			{
				data: {
					verified_at: org.verifiedAt.toISOString(),
					record_id: null,
					dedup_hash: null,
					pepper_version: null,
					already_verified: true,
				},
				error: null,
			},
			200,
		);
	}

	let recordResult: Awaited<ReturnType<typeof recordOrgVerification>>;
	try {
		recordResult = await recordOrgVerification(
			{
				organizationId: body.organization_id,
				documentType: body.document_type,
				documentNumber: body.document_number,
				issuingCountry: body.issuing_country,
			},
			process.env as Record<string, string | undefined>,
		);
	} catch (error) {
		logSafeError(log, {
			code: "org_verification_record_failed",
			details: { organization_id: body.organization_id },
			error,
			event: "org_verifications.finalize.record_failed",
			message: "Failed to record org verification.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Internal server error." as const,
					hint: "The server encountered an error." as const,
					docs: "https://kayle.id/docs/api/errors" as const,
				},
			},
			500,
		);
	}

	const now = new Date();
	await db
		.update(auth_organizations)
		.set({ verified_at: now })
		.where(
			and(
				eq(auth_organizations.id, body.organization_id),
				isNull(auth_organizations.verified_at),
			),
		);

	logEvent(log, {
		details: {
			organization_id: body.organization_id,
			record_id: recordResult.recordId,
			pepper_version: recordResult.pepperVersion,
		},
		event: "org_verifications.finalize.completed",
	});

	return c.json(
		{
			data: {
				verified_at: now.toISOString(),
				record_id: recordResult.recordId,
				dedup_hash: recordResult.dedupHash,
				pepper_version: recordResult.pepperVersion,
				already_verified: false,
			},
			error: null,
		},
		200,
	);
});

export default finalize;
