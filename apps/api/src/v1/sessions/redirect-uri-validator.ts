import {
	ApexExtractionError,
	hostnameToApex,
} from "@kayle-id/auth/domain-verification/apex";
import { isUrlPermittedForOrg } from "@kayle-id/auth/domain-verification/service";
import { parseSafeUrl } from "@kayle-id/config/safe-url";

export type RedirectUriValidationOutcome =
	| { ok: true; normalized: string | null }
	| {
			ok: false;
			code:
				| "INVALID_REDIRECT_URL"
				| "REDIRECT_URL_DOMAIN_NOT_VERIFIED"
				| "REDIRECT_URL_PATTERN_NOT_REGISTERED";
			message: string;
	  };

const ALLOW_LOOPBACK_URLS = process.env.NODE_ENV !== "production";

/**
 * Layered validator for the per-session `redirect_url` field.
 *
 *   1. `null`/empty → accepted (no redirect at handoff).
 *   2. URL shape: delegated to `parseSafeUrl` — same primitive used by the
 *      Zod schema that gates body parsing, so callers are never surprised by
 *      a "the schema accepted it but this rejected it" mismatch.
 *   3. Apex extraction: lowers to ASCII Punycode and computes the eTLD+1.
 *      IDN labels are rejected up front (see `apex.ts`).
 *   4. Org-domain match: the host must equal one of the org's verified
 *      apex domains, or be a subdomain of one. If the apex has any
 *      `auth_organization_redirect_uris` rows, the URL must additionally
 *      match a registered pattern by path-prefix.
 */
export async function validateRedirectUrlForOrg({
	organizationId,
	raw,
}: {
	organizationId: string;
	raw: string | null | undefined;
}): Promise<RedirectUriValidationOutcome> {
	if (!raw) {
		return { ok: true, normalized: null };
	}

	const parsed = parseSafeUrl(raw, {
		allowLoopback: ALLOW_LOOPBACK_URLS,
		mode: "redirect",
	});
	if (!parsed.ok) {
		return {
			ok: false,
			code: "INVALID_REDIRECT_URL",
			message: "Redirect URL is not a valid https:// URL.",
		};
	}

	let host: string;
	try {
		host = hostnameToApex
			? new URL(parsed.url.toString()).hostname.toLowerCase()
			: parsed.url.hostname.toLowerCase();
	} catch {
		return {
			ok: false,
			code: "INVALID_REDIRECT_URL",
			message: "Redirect URL host is malformed.",
		};
	}

	// Loopback hosts (used in dev) bypass the domain-verification gate so the
	// existing local-dev flow keeps working. The safe-url validator already
	// restricts http:// to loopback, so this only kicks in there.
	if (host === "localhost" || host === "127.0.0.1") {
		return { ok: true, normalized: parsed.url.toString() };
	}

	try {
		// Validate apex extraction works for this host (catches bare public
		// suffixes, IDNs, etc.). The membership check below uses the raw host
		// directly; we just want apex to throw on inputs we can't reason about.
		hostnameToApex(host);
	} catch (error) {
		if (error instanceof ApexExtractionError) {
			return {
				ok: false,
				code: "INVALID_REDIRECT_URL",
				message: error.message,
			};
		}
		throw error;
	}

	const decision = await isUrlPermittedForOrg({
		organizationId,
		host,
		fullUrl: parsed.url.toString(),
	});
	if (!decision.ok) {
		if (decision.reason === "pattern_mismatch") {
			return {
				ok: false,
				code: "REDIRECT_URL_PATTERN_NOT_REGISTERED",
				message:
					"Redirect URL host is on a verified domain but does not match any registered redirect URI pattern.",
			};
		}
		return {
			ok: false,
			code: "REDIRECT_URL_DOMAIN_NOT_VERIFIED",
			message:
				"Redirect URL host is not on a verified domain for this organization.",
		};
	}

	return { ok: true, normalized: parsed.url.toString() };
}
