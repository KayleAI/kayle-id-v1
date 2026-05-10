import { OpenAPIHono } from "@hono/zod-openapi";
import {
	DomainVerificationError,
	listOrganizationDomains,
	listOrgOwnerEmails,
	removeVerifiedDomain,
	startDnsChallenge,
	verifyDnsChallenge,
} from "@kayle-id/auth/domain-verification/service";
import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { env } from "@kayle-id/config/env";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { sendDomainTakeoverNotice } from "@kayle-id/emails/send-domain-takeover-notice";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getRequestLogger } from "@/logging";
import {
	listDomainsRoute,
	removeDomainRoute,
	startDnsChallengeRoute,
	verifyDnsChallengeRoute,
} from "./openapi";

const domains = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>();

type DomainCtx = Context<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>;

interface ResolvedActor {
	organizationId: string;
	userId: string;
}

function resolveActor(
	c: DomainCtx,
):
	| { ok: true; actor: ResolvedActor }
	| { ok: false; response: ReturnType<DomainCtx["json"]> } {
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");
	if (!userId) {
		return {
			ok: false,
			response: c.json(
				{
					data: null,
					error: {
						code: "UNAUTHORIZED" as const,
						message: "Sign in to manage verified domains.",
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
			ok: false,
			response: c.json(
				{
					data: null,
					error: {
						code: "FORBIDDEN" as const,
						message: "Select an organization to manage verified domains.",
						hint: "The active session must have an organization selected.",
						docs: "https://kayle.id/docs/api/errors#forbidden",
					},
				},
				403,
			),
		};
	}
	return { ok: true, actor: { organizationId, userId } };
}

async function ensureOrgNotFrozen(
	c: DomainCtx,
	organizationId: string,
): Promise<ReturnType<DomainCtx["json"]> | null> {
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
						hint: "Cancel the pending deletion before managing verified domains.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}
}

function statusCodeFromDomainError(
	error: DomainVerificationError,
): 400 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 {
	const allowed = [400, 403, 404, 409, 422, 429, 500, 502, 503] as const;
	return (allowed as readonly number[]).includes(error.status)
		? (error.status as (typeof allowed)[number])
		: 500;
}

function jsonFromDomainError(
	c: DomainCtx,
	error: DomainVerificationError,
): ReturnType<DomainCtx["json"]> {
	return c.json(
		{
			data: null,
			error: {
				code: error.code,
				message: error.message,
				hint: hintFor(error.code),
				docs: "https://kayle.id/docs/api/errors",
				details: error.details,
			},
		},
		statusCodeFromDomainError(error),
	);
}

async function notifyTakeover({
	apexDomain,
	previousOrganizationId,
	takingOverOrganizationId,
}: {
	apexDomain: string;
	previousOrganizationId: string;
	takingOverOrganizationId: string;
}): Promise<void> {
	if (process.env.NODE_ENV !== "production") {
		// In dev / test we don't have a working SES binding. The structured
		// log from the verify handler is enough to confirm the takeover
		// happened.
		return;
	}

	const [previousOrg] = await db
		.select({ name: auth_organizations.name })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, previousOrganizationId))
		.limit(1);
	const [takingOverOrg] = await db
		.select({ name: auth_organizations.name })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, takingOverOrganizationId))
		.limit(1);
	const owners = await listOrgOwnerEmails(previousOrganizationId);
	const domainsUrl = new URL(
		"/organizations/domains",
		env.PUBLIC_AUTH_URL,
	).toString();

	await Promise.all(
		owners.map((owner) =>
			sendDomainTakeoverNotice({
				apexDomain,
				binding: env.SEND_EMAIL,
				domainsUrl,
				from: env.EMAIL_FROM_ADDRESS,
				organizationName: previousOrg?.name ?? "your organization",
				takingOverOrganizationName:
					takingOverOrg?.name ?? "another organization",
				to: owner.email,
			}),
		),
	);
}

function hintFor(code: DomainVerificationError["code"]): string {
	switch (code) {
		case "APEX_INVALID":
			return "Provide a registrable domain such as `acme.co`. Subdomains and bare public suffixes are not accepted.";
		case "APEX_TAKEOVER_REQUIRED":
			return "Another organization currently holds an active verification for this domain. Re-submit with `acknowledge_takeover: true` to transfer it.";
		case "CHALLENGE_EXPIRED":
		case "CHALLENGE_NOT_FOUND":
			return "Start a new challenge from the Domains page.";
		case "DNS_NOT_PROPAGATED":
			return "Wait for DNS to propagate (typically a few minutes) and verify again.";
		case "DNS_LOOKUP_FAILED":
			return "Network error reaching the DNS resolver. Try again shortly.";
		case "DOMAIN_NOT_FOUND":
			return "Refresh the Domains page and try again.";
		case "FORBIDDEN":
			return "Ask an owner of this organization to perform this action.";
		case "ORGANIZATION_NOT_FOUND":
			return "Provide an existing organization ID.";
		default:
			return "Please try again in a few moments.";
	}
}

domains.openapi(startDnsChallengeRoute, async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const frozen = await ensureOrgNotFrozen(c, actor.actor.organizationId);
	if (frozen) {
		return frozen;
	}

	const { apex_domain } = c.req.valid("json");

	try {
		const result = await startDnsChallenge({
			organizationId: actor.actor.organizationId,
			userId: actor.actor.userId,
			rawApex: apex_domain,
		});
		logEvent(log, {
			details: {
				organization_id: actor.actor.organizationId,
				apex_domain: result.recordName,
				has_conflict: result.conflict !== null,
			},
			event: "organizations.domain_challenge.dns.started",
		});
		return c.json(
			{
				data: {
					challenge_id: result.challengeId,
					record_name: result.recordName,
					record_value: result.recordValue,
					expires_at: result.expiresAt.toISOString(),
					conflict: result.conflict
						? { organization_name: result.conflict.organizationName }
						: null,
				},
				error: null,
			},
			200,
		);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}
		logSafeError(log, {
			code: "domain_challenge_dns_start_failed",
			error,
			event: "organizations.domain_challenge.dns.start.failed",
			message: "Failed to start DNS challenge.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to start DNS challenge.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

domains.openapi(verifyDnsChallengeRoute, async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const frozen = await ensureOrgNotFrozen(c, actor.actor.organizationId);
	if (frozen) {
		return frozen;
	}

	const { challenge_id, acknowledge_takeover } = c.req.valid("json");

	try {
		const result = await verifyDnsChallenge({
			organizationId: actor.actor.organizationId,
			userId: actor.actor.userId,
			challengeId: challenge_id,
			acknowledgeTakeover: acknowledge_takeover ?? false,
		});
		logEvent(log, {
			details: {
				organization_id: actor.actor.organizationId,
				domain_id: result.domainId,
				took_over_from_organization_id:
					result.takeoverFrom?.organizationId ?? null,
			},
			event: result.takeoverFrom
				? "organizations.domain_verified.dns.takeover"
				: "organizations.domain_verified.dns",
		});
		if (result.takeoverFrom) {
			const takeoverPromise = notifyTakeover({
				apexDomain: result.apexDomain,
				previousOrganizationId: result.takeoverFrom.organizationId,
				takingOverOrganizationId: actor.actor.organizationId,
			}).catch((err) =>
				logSafeError(log, {
					code: "domain_takeover_notify_failed",
					error: err,
					event: "organizations.domain_verified.dns.takeover.notify_failed",
					message: "Failed to email previous owner after takeover.",
					status: 500,
				}),
			);
			// `c.executionCtx` is a getter that throws when not bound (e.g.
			// `bun:test`). Use try/catch instead of optional chaining to detect
			// the absence and fall back to fire-and-forget so the response
			// flushes immediately in both runtimes.
			try {
				c.executionCtx.waitUntil(takeoverPromise);
			} catch {
				/* fire-and-forget */
			}
		}
		return c.json(
			{
				data: {
					domain_id: result.domainId,
					apex_domain: result.apexDomain,
					takeover_from: result.takeoverFrom
						? {
								organization_id: result.takeoverFrom.organizationId,
								organization_name: result.takeoverFrom.organizationName,
							}
						: null,
				},
				error: null,
			},
			200,
		);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}
		logSafeError(log, {
			code: "domain_challenge_dns_verify_failed",
			error,
			event: "organizations.domain_challenge.dns.verify.failed",
			message: "Failed to verify DNS challenge.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to verify DNS challenge.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

domains.openapi(listDomainsRoute, async (c) => {
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}

	const { domains: verified, challenges } = await listOrganizationDomains({
		organizationId: actor.actor.organizationId,
	});

	return c.json(
		{
			data: {
				domains: verified.map((d) => ({
					id: d.id,
					apexDomain: d.apexDomain,
					verifiedAt: d.verifiedAt.toISOString(),
					verifiedVia: d.verifiedVia,
					lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
					downgradedAt: d.downgradedAt?.toISOString() ?? null,
				})),
				challenges: challenges.map((c2) => ({
					id: c2.id,
					apexDomain: c2.apexDomain,
					method: c2.method,
					expiresAt: c2.expiresAt.toISOString(),
					createdAt: c2.createdAt.toISOString(),
				})),
			},
			error: null,
		},
		200,
	);
});

domains.openapi(removeDomainRoute, async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const frozen = await ensureOrgNotFrozen(c, actor.actor.organizationId);
	if (frozen) {
		return frozen;
	}

	const { id } = c.req.valid("param");

	try {
		await removeVerifiedDomain({
			organizationId: actor.actor.organizationId,
			userId: actor.actor.userId,
			domainId: id,
		});
		logEvent(log, {
			details: {
				organization_id: actor.actor.organizationId,
				domain_id: id,
			},
			event: "organizations.domain_revoked",
		});
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}
		logSafeError(log, {
			code: "domain_remove_failed",
			error,
			event: "organizations.domain_remove.failed",
			message: "Failed to remove verified domain.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to remove verified domain.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

export { domains };
