import { getOrgDeletionState } from "@kayle-id/auth/organization-deletion";
import { auth, getActiveOrganizationId } from "@kayle-id/auth/server";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { api_keys } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
	type ApiKeyScope,
	isApiKeyScope,
	SCOPE_REQUIRED_ROLE,
} from "@/auth/permissions";
import { checkPermission } from "@/functions/auth/check-permission";
import { createHMAC } from "@/functions/hmac";

type AuthVariables = {
	environment: "live";
	type: "api" | "session";
	organizationId?: string;
	userId?: string;
	permissions?: ApiKeyScope[];
};

const sessionMiddleware = createMiddleware<{
	Bindings: CloudflareBindings;
	Variables: {
		type: "api" | "session";
		organizationId?: string;
		userId?: string;
	};
}>(async (c, next) => {
	const response = await auth.api.getSession(c.req.raw);

	if (!response?.session) {
		return unauthorized(c);
	}

	const activeOrganizationId = getActiveOrganizationId(response.session);

	if (!activeOrganizationId) {
		return forbidden(c);
	}

	c.set("type", "session");
	c.set("organizationId", activeOrganizationId);
	c.set("userId", response.session?.userId);
	await next();
});

const authenticate = createMiddleware<{
	Bindings: CloudflareBindings;
	Variables: AuthVariables;
}>(async (c, next) => {
	const headers = new Headers(c.req.raw.headers);
	const authorization = headers.get("authorization");

	if (authorization?.startsWith("Bearer ")) {
		const apiKey = authorization.split(" ")[1];
		const keyHash = await createHMAC(apiKey, {
			algorithm: "SHA256",
			secret: env.AUTH_SECRET,
		});
		const [
			{ organizationId, environment, enabled, permissions } = {
				organizationId: null,
				environment: "live",
				enabled: false,
				permissions: [] as string[],
			},
		] = await db
			.select({
				organizationId: api_keys.organizationId,
				environment: api_keys.environment,
				enabled: api_keys.enabled,
				permissions: api_keys.permissions,
			})
			.from(api_keys)
			.where(eq(api_keys.keyHash, keyHash))
			.limit(1);

		if (!(organizationId && environment === "live" && enabled)) {
			return unauthorized(c);
		}

		// API-key callers are blocked entirely when the org is frozen.
		// Session callers below stay open so dashboard owners/admins can
		// still see and cancel the pending deletion.
		const deletionState = await getOrgDeletionState(organizationId);
		if (deletionState && deletionState.pendingDeletionAt !== null) {
			return organizationFrozen(c);
		}

		const scopes = Array.isArray(permissions)
			? permissions.filter(isApiKeyScope)
			: [];

		c.set("type", "api");
		c.set("environment", "live");
		c.set("organizationId", organizationId);
		c.set("permissions", scopes);

		return await next();
	}

	// attempt to verify user session
	const response = await auth.api.getSession(c.req.raw);

	if (!response?.session) {
		return unauthorized(c);
	}

	const activeOrganizationId = getActiveOrganizationId(response.session);

	if (!activeOrganizationId) {
		return forbidden(c);
	}

	c.set("type", "session");
	c.set("environment", "live");
	c.set("organizationId", activeOrganizationId);
	c.set("userId", response.session.userId);
	await next();
});

async function sessionCallerHasScope(
	c: Context<{ Bindings: CloudflareBindings; Variables: AuthVariables }>,
	scope: ApiKeyScope,
): Promise<boolean> {
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");

	if (!(userId && organizationId)) {
		return false;
	}

	return checkPermission(userId, organizationId, SCOPE_REQUIRED_ROLE[scope]);
}

/**
 * Hono middleware that enforces a scope on the active caller. API-key callers
 * must have the scope explicitly listed in their key's `permissions` array;
 * session (dashboard) callers must hold an org role that meets or exceeds the
 * scope's required role per `SCOPE_REQUIRED_ROLE`.
 */
export function requireScope(scope: ApiKeyScope) {
	return createMiddleware<{
		Bindings: CloudflareBindings;
		Variables: AuthVariables;
	}>(async (c, next) => {
		if (c.get("type") === "session") {
			if (!(await sessionCallerHasScope(c, scope))) {
				return forbidden(c);
			}
			return next();
		}

		const granted = c.get("permissions") ?? [];

		if (!granted.includes(scope)) {
			return forbidden(c);
		}

		return next();
	});
}

/**
 * Convenience middleware for REST-style sub-routers where GET/HEAD = read scope
 * and any other method = write scope. The write scope implies the read scope —
 * a key (or org role) holding the write tier may still call read routes in
 * the same area.
 */
export function requireReadWriteScope(scopes: {
	read: ApiKeyScope;
	write: ApiKeyScope;
}) {
	return createMiddleware<{
		Bindings: CloudflareBindings;
		Variables: AuthVariables;
	}>(async (c, next) => {
		const method = c.req.method.toUpperCase();
		const isRead = method === "GET" || method === "HEAD";

		if (c.get("type") === "session") {
			const required = isRead ? scopes.read : scopes.write;
			if (!(await sessionCallerHasScope(c, required))) {
				return forbidden(c);
			}
			return next();
		}

		const granted = c.get("permissions") ?? [];

		if (isRead) {
			if (!(granted.includes(scopes.read) || granted.includes(scopes.write))) {
				return forbidden(c);
			}
		} else if (!granted.includes(scopes.write)) {
			return forbidden(c);
		}

		return next();
	});
}

export function unauthorized(c: Context) {
	return c.json(
		{ error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
		401,
	);
}

export function forbidden(c: Context) {
	return c.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, 403);
}

export function organizationFrozen(c: Context) {
	return c.json(
		{
			error: {
				code: "ORGANIZATION_FROZEN",
				message:
					"This organization is scheduled for deletion. API keys and verification flows are disabled until the deletion is canceled.",
			},
		},
		410,
	);
}

/**
 * Returns true (and short-circuits with a 410 response) if the resolved org
 * for this request has a pending deletion. Call after `organizationId` is set
 * on the context. Apply to API-key callers and verification-flow callers; the
 * dashboard owner/admin paths continue to work so they can cancel.
 */
export async function denyIfOrgFrozen(c: Context): Promise<Response | null> {
	const orgId = c.get("organizationId") as string | undefined;
	if (!orgId) {
		return null;
	}
	const state = await getOrgDeletionState(orgId);
	if (state && state.pendingDeletionAt !== null) {
		return organizationFrozen(c);
	}
	return null;
}

export { authenticate, sessionMiddleware };
