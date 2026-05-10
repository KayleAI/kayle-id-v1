import {
	ApexExtractionError,
	hostnameToApex,
} from "@kayle-id/auth/domain-verification/apex";
import { isUrlPermittedForOrg } from "@kayle-id/auth/domain-verification/service";
import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { isPublicVerifySessionHidden } from "./public-session-visibility";

export type RedirectPermittedResult =
	| { code: "SESSION_NOT_FOUND" }
	| { code: "REDIRECT_NOT_SET"; permitted: true }
	| { code: "REDIRECT_PERMITTED"; permitted: true; redirect_url: string }
	| { code: "REDIRECT_DENIED"; permitted: false; redirect_url: string };

/**
 * Used by the verify app's handoff page to defensively re-check, just before
 * redirecting, whether the org's stored `redirect_url` is still on a verified
 * domain. Closes the window between session-create and handoff during which
 * the org's domain may have been downgraded by the cron.
 */
export async function checkRedirectPermitted({
	sessionId,
}: {
	sessionId: string;
}): Promise<RedirectPermittedResult> {
	const [row] = await db
		.select({
			organizationId: verification_sessions.organizationId,
			redirectUrl: verification_sessions.redirectUrl,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!row) {
		return { code: "SESSION_NOT_FOUND" };
	}

	if (await isPublicVerifySessionHidden(row.organizationId)) {
		return { code: "SESSION_NOT_FOUND" };
	}

	if (!row.redirectUrl) {
		return { code: "REDIRECT_NOT_SET", permitted: true };
	}

	let host: string;
	try {
		const url = new URL(row.redirectUrl);
		host = url.hostname.toLowerCase();
		// Loopback hosts (used in dev) bypass the verified-domain gate so the
		// existing local dev flow keeps working.
		if (host === "localhost" || host === "127.0.0.1") {
			return {
				code: "REDIRECT_PERMITTED",
				permitted: true,
				redirect_url: row.redirectUrl,
			};
		}
		hostnameToApex(host);
	} catch (error) {
		if (error instanceof ApexExtractionError) {
			return {
				code: "REDIRECT_DENIED",
				permitted: false,
				redirect_url: row.redirectUrl,
			};
		}
		throw error;
	}

	const decision = await isUrlPermittedForOrg({
		organizationId: row.organizationId,
		host,
		fullUrl: row.redirectUrl,
	});

	if (decision.ok) {
		return {
			code: "REDIRECT_PERMITTED",
			permitted: true,
			redirect_url: row.redirectUrl,
		};
	}

	return {
		code: "REDIRECT_DENIED",
		permitted: false,
		redirect_url: row.redirectUrl,
	};
}
