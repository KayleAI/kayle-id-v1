import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { memberHasOwnerRoleSql } from "@kayle-id/auth/organization-role-sql";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organization_rp_terms_acceptances,
} from "@kayle-id/database/schema/auth";
import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { getRequestLogger } from "@/logging";
import { acceptRpTermsRoute, getRpTermsRoute } from "./openapi";

const rpTerms = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>();

type RpTermsCtx = Context<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>;

interface ResolvedActor {
	organizationId: string;
	userId: string;
}

interface RpTermsAcceptanceRow {
	acceptedAt: Date;
	acceptedBy: string | null;
	jurisdiction: string;
	termsHash: string;
	termsVersion: string;
}

const currentRpTerms = {
	jurisdiction: RP_INTEGRATION_TERMS_JURISDICTION,
	terms_hash: RP_INTEGRATION_TERMS_HASH,
	terms_version: RP_INTEGRATION_TERMS_VERSION,
} as const;

function resolveActor(c: RpTermsCtx) {
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");
	if (!userId) {
		return {
			ok: false as const,
			response: c.json(
				{
					data: null,
					error: {
						code: "UNAUTHORIZED" as const,
						message: "Sign in to manage RP integration terms.",
						hint: "Send a session cookie or use a session-authenticated client.",
						docs: "https://kayle.id/docs/api/errors#unauthorized",
					},
				},
				401,
			),
		};
	}
	if (!organizationId) {
		return {
			ok: false as const,
			response: c.json(
				{
					data: null,
					error: {
						code: "FORBIDDEN" as const,
						message: "Select an organization to manage RP integration terms.",
						hint: "The active session must have an organization selected.",
						docs: "https://kayle.id/docs/api/errors#forbidden",
					},
				},
				403,
			),
		};
	}
	return {
		ok: true as const,
		actor: { organizationId, userId } satisfies ResolvedActor,
	};
}

async function ensureOrgNotFrozen(c: RpTermsCtx, organizationId: string) {
	try {
		await assertOrgNotFrozen(organizationId);
		return null;
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_FROZEN" as const,
						message: error.message,
						hint: "Cancel the pending deletion before accepting RP integration terms.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}
}

async function getCurrentAcceptance(
	organizationId: string,
): Promise<RpTermsAcceptanceRow | null> {
	const [acceptance] = await db
		.select({
			acceptedAt: auth_organization_rp_terms_acceptances.acceptedAt,
			acceptedBy: auth_organization_rp_terms_acceptances.acceptedBy,
			jurisdiction: auth_organization_rp_terms_acceptances.jurisdiction,
			termsHash: auth_organization_rp_terms_acceptances.termsHash,
			termsVersion: auth_organization_rp_terms_acceptances.termsVersion,
		})
		.from(auth_organization_rp_terms_acceptances)
		.where(
			and(
				eq(
					auth_organization_rp_terms_acceptances.organizationId,
					organizationId,
				),
				eq(
					auth_organization_rp_terms_acceptances.termsVersion,
					RP_INTEGRATION_TERMS_VERSION,
				),
				eq(
					auth_organization_rp_terms_acceptances.termsHash,
					RP_INTEGRATION_TERMS_HASH,
				),
				eq(
					auth_organization_rp_terms_acceptances.jurisdiction,
					RP_INTEGRATION_TERMS_JURISDICTION,
				),
			),
		)
		.limit(1);

	return acceptance ?? null;
}

function toStatusResponse(acceptance: RpTermsAcceptanceRow | null) {
	return {
		acceptance: acceptance
			? {
					accepted_at: acceptance.acceptedAt.toISOString(),
					accepted_by: acceptance.acceptedBy,
					jurisdiction: acceptance.jurisdiction,
					terms_hash: acceptance.termsHash,
					terms_version: acceptance.termsVersion,
				}
			: null,
		current: currentRpTerms,
		current_accepted: Boolean(acceptance),
	};
}

rpTerms.openapi(getRpTermsRoute, async (c) => {
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}

	const acceptance = await getCurrentAcceptance(actor.actor.organizationId);

	return c.json(
		{
			data: toStatusResponse(acceptance),
			error: null,
		},
		200,
	);
});

rpTerms.openapi(acceptRpTermsRoute, async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const { organizationId, userId } = actor.actor;

	const frozenResponse = await ensureOrgNotFrozen(c, organizationId);
	if (frozenResponse) {
		return frozenResponse;
	}

	const [membership] = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
				isNull(auth_organization_members.suspendedAt),
				memberHasOwnerRoleSql(),
			),
		)
		.limit(1);

	if (!membership) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Only an owner can accept RP integration terms.",
					hint: "Ask an owner of this organization to accept the current RP integration terms.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	try {
		await db
			.insert(auth_organization_rp_terms_acceptances)
			.values({
				organizationId,
				termsVersion: RP_INTEGRATION_TERMS_VERSION,
				termsHash: RP_INTEGRATION_TERMS_HASH,
				jurisdiction: RP_INTEGRATION_TERMS_JURISDICTION,
				acceptedBy: userId,
			})
			.onConflictDoNothing({
				target: [
					auth_organization_rp_terms_acceptances.organizationId,
					auth_organization_rp_terms_acceptances.termsVersion,
					auth_organization_rp_terms_acceptances.termsHash,
					auth_organization_rp_terms_acceptances.jurisdiction,
				],
			});

		const acceptance = await getCurrentAcceptance(organizationId);
		if (!acceptance) {
			throw new Error("rp_terms_acceptance_missing_after_insert");
		}

		logEvent(log, {
			details: {
				organization_id: organizationId,
				terms_hash: RP_INTEGRATION_TERMS_HASH,
				terms_version: RP_INTEGRATION_TERMS_VERSION,
			},
			event: "organizations.rp_terms.accepted",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: userId,
			organizationId,
			event: "organization.rp_terms.accepted",
			targetId: organizationId,
			targetType: "organization",
			metadata: {
				jurisdiction: RP_INTEGRATION_TERMS_JURISDICTION,
				terms_hash: RP_INTEGRATION_TERMS_HASH,
				terms_version: RP_INTEGRATION_TERMS_VERSION,
			},
		});

		return c.json(
			{
				data: toStatusResponse(acceptance),
				error: null,
			},
			200,
		);
	} catch (error) {
		logSafeError(log, {
			code: "rp_terms_accept_failed",
			details: { organization_id: organizationId },
			error,
			event: "organizations.rp_terms.accept.failed",
			message: "Failed to record RP integration terms acceptance.",
			status: 500,
		});

		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to record RP integration terms acceptance.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

export { rpTerms };
