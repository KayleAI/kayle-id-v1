import type { DomainVerificationError } from "@kayle-id/auth/domain-verification/service";
import { logSafeError } from "@kayle-id/config/logging";
import type { Context } from "hono";
import type { ApiRequestLogger } from "@/logging";
import type { DomainsAppEnv } from "./types";

type DomainCtx = Context<DomainsAppEnv>;

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

function statusCodeFromDomainError(
	error: DomainVerificationError,
): 400 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 {
	const allowed = [400, 403, 404, 409, 422, 429, 500, 502, 503] as const;
	return (allowed as readonly number[]).includes(error.status)
		? (error.status as (typeof allowed)[number])
		: 500;
}

export function jsonFromDomainError(
	c: DomainCtx,
	error: DomainVerificationError,
) {
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

export function jsonFromUnexpectedDomainError(
	c: DomainCtx,
	logger: ApiRequestLogger,
	{
		code,
		error,
		event,
		message,
	}: {
		code: string;
		error: unknown;
		event: string;
		message: string;
	},
) {
	logSafeError(logger, {
		code,
		error,
		event,
		message,
		status: 500,
	});

	return c.json(
		{
			data: null,
			error: {
				code: "INTERNAL_SERVER_ERROR" as const,
				message,
				hint: "Please try again in a few moments.",
				docs: "https://kayle.id/docs/api/errors#internal_server_error",
			},
		},
		500,
	);
}
