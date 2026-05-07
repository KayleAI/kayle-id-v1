import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { auth } from "@kayle-id/auth/server";
import { logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import { ErrorResponse } from "@/openapi/base";
import { InternalServerErrorResponse } from "@/openapi/errors";
import { Session } from "@/openapi/models/sessions";
import { generateId } from "@/utils/generate-id";
import { normalizeShareFields } from "@/v1/sessions/domain/share-contract/normalize-share-fields";
import { mapSessionRowToResponse } from "@/v1/sessions/mappers/session-response";
import { createVerificationSession } from "@/v1/sessions/repo/session-repo";
import type { SessionsAppEnv } from "@/v1/sessions/types";

const contractVersion = 1;
const docs = "https://kayle.id/docs/api/org-verifications";

const createOrgVerificationSession = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							organization_id: z
								.string()
								.uuid()
								.describe("UUID of the organization whose owner is verifying."),
							redirect_url: z
								.string()
								.url()
								.optional()
								.describe(
									"Optional URL to redirect to after verification completes.",
								),
						})
						.openapi("CreateOrgVerificationSessionRequest"),
				},
			},
			required: true,
		},
	},
	tags: ["Org Verification"],
	summary:
		"Create a verification session for the owner of another organization (platform-only)",
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: Session,
						error: z.null(),
					}),
				},
			},
			description: "Owner-verification session created.",
		},
		400: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Bad request.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller lacks `org_verifications:write` scope.",
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

const orgVerification = new OpenAPIHono<SessionsAppEnv>();

orgVerification.openapi(createOrgVerificationSession, async (c) => {
	const callerOrgId = c.get("organizationId");
	const log = getRequestLogger(c);
	const body = c.req.valid("json");

	const targetOrgId = body.organization_id;
	const [target] = await db
		.select({
			id: auth_organizations.id,
			verifiedAt: auth_organizations.verified_at,
			verificationTermsAcceptedAt:
				auth_organizations.verification_terms_accepted_at,
			verificationTermsAcceptedBy:
				auth_organizations.verification_terms_accepted_by,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, targetOrgId))
		.limit(1);

	if (!target) {
		return c.json(
			{
				data: null,
				error: {
					code: "ORGANIZATION_NOT_FOUND",
					message: "Organization not found.",
					hint: "Provide an existing organization ID.",
					docs,
				},
			},
			404,
		);
	}

	if (target.verifiedAt) {
		return c.json(
			{
				data: null,
				error: {
					code: "ORGANIZATION_ALREADY_VERIFIED",
					message: "Organization is already verified.",
					hint: "Verified organizations do not need to verify their owner again.",
					docs,
				},
			},
			400,
		);
	}

	if (
		!target.verificationTermsAcceptedAt ||
		!target.verificationTermsAcceptedBy
	) {
		return c.json(
			{
				data: null,
				error: {
					code: "VERIFICATION_TERMS_NOT_ACCEPTED",
					message: "Owner has not yet accepted the verification terms.",
					hint: "Capture the business details and terms acceptance (timestamp and accepting user) before initiating the owner ID check.",
					docs,
				},
			},
			400,
		);
	}

	// When the request carries a session cookie alongside the platform-internal
	// API key, the dashboard is acting on behalf of a logged-in user. Require
	// that user to be an owner of the target org so a malicious caller can't
	// trigger verification for an org they don't belong to. If no session is
	// present (e.g., a backend admin script calling with just the API key), we
	// trust the scoped key.
	const sessionResponse = await auth.api.getSession(c.req.raw);
	const actingUserId = sessionResponse?.session?.userId ?? null;
	if (actingUserId) {
		const [member] = await db
			.select({ role: auth_organization_members.role })
			.from(auth_organization_members)
			.where(
				and(
					eq(auth_organization_members.organizationId, targetOrgId),
					eq(auth_organization_members.userId, actingUserId),
				),
			)
			.limit(1);
		if (!member?.role.split(",").includes("owner")) {
			return c.json(
				{
					data: null,
					error: {
						code: "FORBIDDEN",
						message: "Acting user is not an owner of the target organization.",
						hint: "Only an owner of the target organization can initiate its owner-verification flow.",
						docs,
					},
				},
				403,
			);
		}
	}

	// Identity-revealing share fields (default set) — the dedup hash needs the
	// document number from DG1, which only flows through identity sessions.
	const normalized = normalizeShareFields(undefined);
	if (!normalized.ok) {
		throw new Error("default_share_fields_invalid");
	}

	const id = generateId({ type: "vs" });
	const { row, cancelToken } = await createVerificationSession({
		id,
		organizationId: callerOrgId,
		redirectUrl: body.redirect_url ?? null,
		shareFields: normalized.shareFields,
		contractVersion,
		isAgeOnly: false,
		ownerVerificationOrgId: targetOrgId,
	});

	logEvent(log, {
		details: {
			caller_organization_id: callerOrgId,
			target_organization_id: targetOrgId,
			session_id: row.id,
		},
		event: "org_verifications.create.created",
	});

	const data = mapSessionRowToResponse({
		row,
		cancelToken,
	});

	return c.json({ data, error: null }, 200);
});

export default orgVerification;
