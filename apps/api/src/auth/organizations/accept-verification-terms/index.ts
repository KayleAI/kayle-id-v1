import { OpenAPIHono } from "@hono/zod-openapi";
import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import { acceptVerificationTermsRoute } from "./openapi";

const acceptVerificationTerms = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { userId?: string };
}>();

acceptVerificationTerms.openapi(acceptVerificationTermsRoute, async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	if (!userId) {
		return c.json(
			{
				data: null,
				error: {
					code: "UNAUTHORIZED" as const,
					message: "Sign in to accept verification terms.",
					hint: "Send a session cookie or use a session-authenticated client.",
					docs: "https://kayle.id/docs/api/errors#unauthorized",
				},
			},
			401,
		);
	}

	const { organizationId } = c.req.valid("json");

	try {
		await assertOrgNotFrozen(organizationId);
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_FROZEN" as const,
						message: error.message,
						hint: "Cancel the pending deletion before accepting verification terms.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}

	const [org] = await db
		.select({
			id: auth_organizations.id,
			verifiedAt: auth_organizations.verified_at,
			verificationTermsAcceptedAt:
				auth_organizations.verification_terms_accepted_at,
			verificationTermsAcceptedBy:
				auth_organizations.verification_terms_accepted_by,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);

	if (!org) {
		return c.json(
			{
				data: null,
				error: {
					code: "ORGANIZATION_NOT_FOUND" as const,
					message: "Organization not found.",
					hint: "Provide an existing organization ID.",
					docs: "https://kayle.id/docs/api/errors#not_found",
				},
			},
			404,
		);
	}

	if (org.verifiedAt) {
		return c.json(
			{
				data: null,
				error: {
					code: "ORGANIZATION_ALREADY_VERIFIED" as const,
					message: "Organization is already verified.",
					hint: "Verified organizations do not need to re-accept the verification terms.",
					docs: "https://kayle.id/docs/api/errors#conflict",
				},
			},
			409,
		);
	}

	const [membership] = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
			),
		)
		.limit(1);

	if (!membership?.role.split(",").includes("owner")) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Only an owner can accept verification terms.",
					hint: "Ask an owner of this organization to accept the terms.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	if (org.verificationTermsAcceptedAt && org.verificationTermsAcceptedBy) {
		return c.json(
			{
				data: {
					verificationTermsAcceptedAt:
						org.verificationTermsAcceptedAt.toISOString(),
					verificationTermsAcceptedBy: org.verificationTermsAcceptedBy,
				},
				error: null,
			},
			200,
		);
	}

	const now = new Date();

	try {
		await db
			.update(auth_organizations)
			.set({
				verification_terms_accepted_at: now,
				verification_terms_accepted_by: userId,
			})
			.where(eq(auth_organizations.id, organizationId));
	} catch (error) {
		logSafeError(log, {
			code: "verification_terms_accept_failed",
			details: { organization_id: organizationId },
			error,
			event: "organizations.verification_terms.accept.failed",
			message: "Failed to record verification terms acceptance.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to record verification terms acceptance.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}

	logEvent(log, {
		details: {
			organization_id: organizationId,
		},
		event: "organizations.verification_terms.accepted",
	});

	return c.json(
		{
			data: {
				verificationTermsAcceptedAt: now.toISOString(),
				verificationTermsAcceptedBy: userId,
			},
			error: null,
		},
		200,
	);
});

export { acceptVerificationTerms };
