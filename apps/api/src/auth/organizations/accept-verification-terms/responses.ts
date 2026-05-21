import type {
	AcceptedVerificationTerms,
	AcceptVerificationTermsContext,
} from "./types";

const docs = {
	conflict: "https://kayle.id/docs/api/errors#conflict",
	forbidden: "https://kayle.id/docs/api/errors#forbidden",
	internalServerError: "https://kayle.id/docs/api/errors#internal_server_error",
	notFound: "https://kayle.id/docs/api/errors#not_found",
	organizationFrozen: "https://kayle.id/docs/api/errors#organization_frozen",
	unauthorized: "https://kayle.id/docs/api/errors#unauthorized",
} as const;

export function verificationTermsAcceptedResponse(
	c: AcceptVerificationTermsContext,
	accepted: AcceptedVerificationTerms,
) {
	return c.json(
		{
			data: {
				verificationTermsAcceptedAt:
					accepted.verificationTermsAcceptedAt.toISOString(),
				verificationTermsAcceptedBy: accepted.verificationTermsAcceptedBy,
			},
			error: null,
		},
		200,
	);
}

export function unauthorizedResponse(c: AcceptVerificationTermsContext) {
	return c.json(
		{
			data: null,
			error: {
				code: "UNAUTHORIZED" as const,
				message: "Sign in to accept verification terms.",
				hint: "Send a session cookie or use a session-authenticated client.",
				docs: docs.unauthorized,
			},
		},
		401,
	);
}

export function organizationFrozenResponse(
	c: AcceptVerificationTermsContext,
	message: string,
) {
	return c.json(
		{
			data: null,
			error: {
				code: "ORGANIZATION_FROZEN" as const,
				message,
				hint: "Cancel the pending deletion before accepting verification terms.",
				docs: docs.organizationFrozen,
			},
		},
		410,
	);
}

export function organizationNotFoundResponse(
	c: AcceptVerificationTermsContext,
) {
	return c.json(
		{
			data: null,
			error: {
				code: "ORGANIZATION_NOT_FOUND" as const,
				message: "Organization not found.",
				hint: "Provide an existing organization ID.",
				docs: docs.notFound,
			},
		},
		404,
	);
}

export function organizationAlreadyVerifiedResponse(
	c: AcceptVerificationTermsContext,
) {
	return c.json(
		{
			data: null,
			error: {
				code: "ORGANIZATION_ALREADY_VERIFIED" as const,
				message: "Organization is already verified.",
				hint: "Verified organizations do not need to re-accept the verification terms.",
				docs: docs.conflict,
			},
		},
		409,
	);
}

export function forbiddenResponse(c: AcceptVerificationTermsContext) {
	return c.json(
		{
			data: null,
			error: {
				code: "FORBIDDEN" as const,
				message: "Only an owner can accept verification terms.",
				hint: "Ask an owner of this organization to accept the terms.",
				docs: docs.forbidden,
			},
		},
		403,
	);
}

export function recordFailedResponse(c: AcceptVerificationTermsContext) {
	return c.json(
		{
			data: null,
			error: {
				code: "INTERNAL_SERVER_ERROR" as const,
				message: "Failed to record verification terms acceptance.",
				hint: "Please try again in a few moments.",
				docs: docs.internalServerError,
			},
		},
		500,
	);
}
