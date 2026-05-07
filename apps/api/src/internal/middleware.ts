import { env } from "@kayle-id/config/env";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

/**
 * Constant-time string equality. Avoids the early-exit timing channel of `===`
 * when comparing secrets supplied by callers.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let mismatch = 0;
	for (let i = 0; i < a.length; i += 1) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

function unauthorized(c: Context) {
	return c.json(
		{
			data: null,
			error: {
				code: "UNAUTHORIZED" as const,
				message: "Internal trust token is missing or invalid.",
			},
		},
		401,
	);
}

/**
 * Internal-only Hono middleware: requires `Authorization: Bearer <token>` to
 * match `env.KAYLE_INTERNAL_TOKEN` exactly. Used to gate platform-to-API calls
 * that perform privileged DB writes (e.g. flipping `auth_organizations.verified_at`).
 *
 * No DB lookup, no scope concept — the trust token is the entire authority.
 */
export const requireInternalTrustToken = createMiddleware<{
	Bindings: CloudflareBindings;
}>(async (c, next) => {
	const expected = env.KAYLE_INTERNAL_TOKEN;
	if (!expected) {
		return unauthorized(c);
	}

	const header = c.req.header("Authorization");
	if (!header?.startsWith("Bearer ")) {
		return unauthorized(c);
	}
	const provided = header.slice("Bearer ".length).trim();
	if (provided.length === 0 || !timingSafeEqual(provided, expected)) {
		return unauthorized(c);
	}

	await next();
});
