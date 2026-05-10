import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	ApexExtractionError,
	hostnameToApex,
} from "@kayle-id/auth/domain-verification/apex";
import {
	addRedirectUri,
	DomainVerificationError,
	listRedirectUris,
	removeRedirectUri,
} from "@kayle-id/auth/domain-verification/service";
import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import type { Context } from "hono";
import { getRequestLogger } from "@/logging";
import {
	addRedirectUriRoute,
	listRedirectUrisRoute,
	removeRedirectUriRoute,
} from "./openapi";

const redirectUris = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>();

type RedirectUriCtx = Context<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>;

interface ResolvedActor {
	organizationId: string;
	userId: string;
}

function resolveActor(
	c: RedirectUriCtx,
):
	| { ok: true; actor: ResolvedActor }
	| { ok: false; response: ReturnType<RedirectUriCtx["json"]> } {
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
						message: "Sign in to manage redirect URIs.",
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
						message: "Select an organization to manage redirect URIs.",
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
	c: RedirectUriCtx,
	organizationId: string,
): Promise<ReturnType<RedirectUriCtx["json"]> | null> {
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
						hint: "Cancel the pending deletion before managing redirect URIs.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}
}

function jsonFromDomainError(
	c: RedirectUriCtx,
	error: DomainVerificationError,
): ReturnType<RedirectUriCtx["json"]> {
	const allowed = [400, 403, 404, 422, 500] as const;
	const status = (allowed as readonly number[]).includes(error.status)
		? (error.status as (typeof allowed)[number])
		: 500;
	return c.json(
		{
			data: null,
			error: {
				code: error.code,
				message: error.message,
				hint:
					error.code === "DOMAIN_NOT_FOUND"
						? "Verify a domain that covers this URL's host first."
						: "Refresh the Domains page and try again.",
				docs: "https://kayle.id/docs/api/errors",
			},
		},
		status,
	);
}

redirectUris.openapi(listRedirectUrisRoute, async (c) => {
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const rows = await listRedirectUris({
		organizationId: actor.actor.organizationId,
	});
	return c.json(
		{
			data: rows.map((r) => ({
				id: r.id,
				verifiedDomainId: r.verifiedDomainId,
				apexDomain: r.apexDomain,
				pattern: r.pattern,
				createdAt: r.createdAt.toISOString(),
			})),
			error: null,
		},
		200,
	);
});

redirectUris.openapi(addRedirectUriRoute, async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const frozen = await ensureOrgNotFrozen(c, actor.actor.organizationId);
	if (frozen) {
		return frozen;
	}

	const { pattern } = c.req.valid("json");

	let host: string;
	let apex: string;
	try {
		host = new URL(pattern).hostname.toLowerCase();
		apex = hostnameToApex(host);
	} catch (error) {
		const message =
			error instanceof ApexExtractionError
				? error.message
				: "Pattern URL is malformed.";
		return c.json(
			{
				data: null,
				error: {
					code: "INVALID_PATTERN" as const,
					message,
					hint: "Provide a fully-qualified https:// URL whose host is one of your verified domains or a subdomain of one.",
					docs: "https://kayle.id/docs/api/errors#bad_request",
				},
			},
			400,
		);
	}

	try {
		const result = await addRedirectUri({
			organizationId: actor.actor.organizationId,
			userId: actor.actor.userId,
			pattern,
			matchingApexDomain: apex,
		});
		logEvent(log, {
			details: {
				organization_id: actor.actor.organizationId,
				verified_domain_id: result.verifiedDomainId,
			},
			event: "organizations.redirect_uri.added",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: actor.actor.userId,
			organizationId: actor.actor.organizationId,
			event: "redirect_uri.added",
			targetId: result.id,
			targetType: "redirect_uri",
			metadata: {
				pattern,
				apex_domain: apex,
				verified_domain_id: result.verifiedDomainId,
			},
		});
		return c.json(
			{
				data: {
					id: result.id,
					verifiedDomainId: result.verifiedDomainId,
					apexDomain: apex,
					pattern,
					createdAt: new Date().toISOString(),
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
			code: "redirect_uri_add_failed",
			error,
			event: "organizations.redirect_uri.add.failed",
			message: "Failed to add redirect URI.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to add redirect URI.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

redirectUris.openapi(removeRedirectUriRoute, async (c) => {
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
		await removeRedirectUri({
			organizationId: actor.actor.organizationId,
			userId: actor.actor.userId,
			redirectUriId: id,
		});
		logEvent(log, {
			details: {
				organization_id: actor.actor.organizationId,
				redirect_uri_id: id,
			},
			event: "organizations.redirect_uri.removed",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: actor.actor.userId,
			organizationId: actor.actor.organizationId,
			event: "redirect_uri.removed",
			targetId: id,
			targetType: "redirect_uri",
		});
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}
		logSafeError(log, {
			code: "redirect_uri_remove_failed",
			error,
			event: "organizations.redirect_uri.remove.failed",
			message: "Failed to remove redirect URI.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to remove redirect URI.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

export { redirectUris };
