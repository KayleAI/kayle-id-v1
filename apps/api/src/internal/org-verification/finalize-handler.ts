import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { memberHasOwnerRoleSql } from "@kayle-id/auth/organization-role-sql";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import {
	org_verification_records,
	orgVerificationDocumentTypes,
} from "@kayle-id/database/schema/core";
import { and, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import { ErrorResponse } from "@/openapi/base";
import { InternalServerErrorResponse } from "@/openapi/errors";
import { ISSUING_COUNTRY_CODE_PATTERN } from "./dedup";
import { prepareOrgVerificationRecord } from "./records-repo";

const docs = "https://kayle.id/docs/api/internal/org-verification";
const MAX_DOCUMENT_NUMBER_LENGTH = 128;
const issuingCountrySchema = z
	.string()
	.trim()
	.transform((value) => value.toUpperCase())
	.pipe(z.string().regex(ISSUING_COUNTRY_CODE_PATTERN));

const finalizeOrgVerificationRoute = createRoute({
	hide: true,
	method: "post",
	path: "/finalize",
	tags: ["Internal"],
	summary:
		"Finalize an organization verification: write the dedup hash row and record the org owner's ID check.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organization_id: z.string().uuid(),
						document_type: z.enum(orgVerificationDocumentTypes),
						document_number: z.string().min(1).max(MAX_DOCUMENT_NUMBER_LENGTH),
						issuing_country: issuingCountrySchema,
						owner_user_id: z.string().uuid(),
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
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description:
				"The user who started verification is no longer an organization owner.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Target organization does not exist.",
		},
		410: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Target organization is scheduled for deletion.",
		},
		409: {
			content: { "application/json": { schema: ErrorResponse } },
			description:
				"The verified document is already bound to another organization.",
		},
		500: {
			content: { "application/json": { schema: InternalServerErrorResponse } },
			description: "Internal server error.",
		},
	},
});

const finalize = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

type FinalizeResult =
	| {
			alreadyVerified: false;
			dedupHash: string;
			kind: "verified";
			pepperVersion: number;
			recordId: string;
			verifiedAt: Date;
	  }
	| {
			alreadyVerified: true;
			kind: "already_verified";
			verifiedAt: Date;
	  }
	| {
			kind: "document_conflict";
			recordOrganizationId: string;
	  }
	| {
			kind: "frozen";
	  }
	| {
			kind: "owner_not_active";
	  };

finalize.openapi(finalizeOrgVerificationRoute, async (c) => {
	const log = getRequestLogger(c);
	const body = c.req.valid("json");

	const [org] = await db
		.select({
			id: auth_organizations.id,
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			verifiedAt: auth_organizations.owner_id_checked_at,
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

	if (org.pendingDeletionAt) {
		return c.json(
			{
				data: null,
				error: {
					code: "ORGANIZATION_FROZEN" as const,
					message:
						"Organization is scheduled for deletion. Cancel the deletion before finalizing verification.",
					hint: "Cancel the pending deletion and retry the organization verification flow.",
					docs,
				},
			},
			410,
		);
	}

	let preparedRecord: Awaited<ReturnType<typeof prepareOrgVerificationRecord>>;
	try {
		preparedRecord = await prepareOrgVerificationRecord(
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
	const finalizeResult = await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${preparedRecord.dedupHash}::text, 2))`,
		);

		const [existingRecord] = await tx
			.select({
				id: org_verification_records.id,
				dedupHash: org_verification_records.dedupHash,
				organizationId: org_verification_records.organizationId,
				pepperVersion: org_verification_records.pepperVersion,
			})
			.from(org_verification_records)
			.where(
				inArray(
					org_verification_records.dedupHash,
					preparedRecord.candidateHashes,
				),
			)
			.limit(1);

		if (
			existingRecord &&
			existingRecord.organizationId !== body.organization_id
		) {
			return {
				kind: "document_conflict",
				recordOrganizationId: existingRecord.organizationId,
			} satisfies FinalizeResult;
		}

		const [updatedOrg] = await tx
			.update(auth_organizations)
			.set({ owner_id_checked_at: now })
			.where(
				and(
					eq(auth_organizations.id, body.organization_id),
					isNull(auth_organizations.owner_id_checked_at),
					isNull(auth_organizations.pending_deletion_at),
					exists(
						tx
							.select({ presence: sql`1` })
							.from(auth_organization_members)
							.where(
								and(
									eq(
										auth_organization_members.organizationId,
										auth_organizations.id,
									),
									eq(auth_organization_members.userId, body.owner_user_id),
									isNull(auth_organization_members.suspendedAt),
									memberHasOwnerRoleSql(),
								),
							),
					),
				),
			)
			.returning({
				verifiedAt: auth_organizations.owner_id_checked_at,
			});

		if (!updatedOrg?.verifiedAt) {
			const [currentOrg] = await tx
				.select({
					pendingDeletionAt: auth_organizations.pending_deletion_at,
					verifiedAt: auth_organizations.owner_id_checked_at,
				})
				.from(auth_organizations)
				.where(eq(auth_organizations.id, body.organization_id))
				.limit(1);

			if (currentOrg?.verifiedAt) {
				return {
					alreadyVerified: true,
					kind: "already_verified",
					verifiedAt: currentOrg.verifiedAt,
				} satisfies FinalizeResult;
			}

			if (currentOrg?.pendingDeletionAt) {
				return { kind: "frozen" } satisfies FinalizeResult;
			}

			return { kind: "owner_not_active" } satisfies FinalizeResult;
		}

		if (existingRecord) {
			return {
				alreadyVerified: false,
				dedupHash: existingRecord.dedupHash,
				kind: "verified",
				pepperVersion: existingRecord.pepperVersion,
				recordId: existingRecord.id,
				verifiedAt: updatedOrg.verifiedAt,
			} satisfies FinalizeResult;
		}

		const [recordRow] = await tx
			.insert(org_verification_records)
			.values({
				organizationId: body.organization_id,
				dedupHash: preparedRecord.dedupHash,
				pepperVersion: preparedRecord.pepperVersion,
				documentType: body.document_type,
				issuingCountry: body.issuing_country,
			})
			.returning({ id: org_verification_records.id });

		if (!recordRow) {
			throw new Error("org_verification_record_insert_returned_no_row");
		}

		return {
			alreadyVerified: false,
			dedupHash: preparedRecord.dedupHash,
			kind: "verified",
			pepperVersion: preparedRecord.pepperVersion,
			recordId: recordRow.id,
			verifiedAt: updatedOrg.verifiedAt,
		} satisfies FinalizeResult;
	});

	if (finalizeResult.kind === "already_verified") {
		logEvent(log, {
			details: {
				organization_id: body.organization_id,
				already_verified: true,
			},
			event: "org_verifications.finalize.idempotent",
		});
		return c.json(
			{
				data: {
					verified_at: finalizeResult.verifiedAt.toISOString(),
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

	if (finalizeResult.kind === "frozen") {
		return c.json(
			{
				data: null,
				error: {
					code: "ORGANIZATION_FROZEN" as const,
					message:
						"Organization is scheduled for deletion. Cancel the deletion before finalizing verification.",
					hint: "Cancel the pending deletion and retry the organization verification flow.",
					docs,
				},
			},
			410,
		);
	}

	if (finalizeResult.kind === "owner_not_active") {
		return c.json(
			{
				data: null,
				error: {
					code: "OWNER_NOT_ACTIVE" as const,
					message:
						"The user who started verification is no longer an owner of this organization.",
					hint: "Start a new verification flow as a current organization owner.",
					docs,
				},
			},
			403,
		);
	}

	if (finalizeResult.kind === "document_conflict") {
		logEvent(log, {
			details: {
				organization_id: body.organization_id,
				record_organization_id: finalizeResult.recordOrganizationId,
			},
			event: "org_verifications.finalize.document_conflict",
		});
		return c.json(
			{
				data: null,
				error: {
					code: "DOCUMENT_ALREADY_USED" as const,
					message:
						"This document has already been used to verify another organization.",
					hint: "Use a different eligible identity document for this organization.",
					docs,
				},
			},
			409,
		);
	}

	logEvent(log, {
		details: {
			organization_id: body.organization_id,
			record_id: finalizeResult.recordId,
			pepper_version: finalizeResult.pepperVersion,
		},
		event: "org_verifications.finalize.completed",
	});

	return c.json(
		{
			data: {
				verified_at: finalizeResult.verifiedAt.toISOString(),
				record_id: finalizeResult.recordId,
				dedup_hash: finalizeResult.dedupHash,
				pepper_version: finalizeResult.pepperVersion,
				already_verified: false,
			},
			error: null,
		},
		200,
	);
});

export default finalize;
