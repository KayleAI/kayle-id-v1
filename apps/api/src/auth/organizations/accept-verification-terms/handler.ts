import type { RouteHandler } from "@hono/zod-openapi";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import type { acceptVerificationTermsRoute } from "./openapi";
import {
	forbiddenResponse,
	organizationAlreadyVerifiedResponse,
	organizationFrozenResponse,
	organizationNotFoundResponse,
	recordFailedResponse,
	unauthorizedResponse,
	verificationTermsAcceptedResponse,
} from "./responses";
import { acceptVerificationTermsForOwner } from "./service";
import type { AcceptVerificationTermsEnv } from "./types";

export const acceptVerificationTermsHandler: RouteHandler<
	typeof acceptVerificationTermsRoute,
	AcceptVerificationTermsEnv
> = async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	if (!userId) {
		return unauthorizedResponse(c);
	}

	const { organizationId } = c.req.valid("json");
	const result = await acceptVerificationTermsForOwner({
		organizationId,
		userId,
	});

	if (result.kind === "accepted") {
		logEvent(log, {
			details: {
				organization_id: organizationId,
			},
			event: "organizations.verification_terms.accepted",
		});
		return verificationTermsAcceptedResponse(c, result);
	}

	if (result.kind === "organization_frozen") {
		return organizationFrozenResponse(c, result.message);
	}

	if (result.kind === "not_found") {
		return organizationNotFoundResponse(c);
	}

	if (result.kind === "already_verified") {
		return organizationAlreadyVerifiedResponse(c);
	}

	if (result.kind === "forbidden") {
		return forbiddenResponse(c);
	}

	logSafeError(log, {
		code: "verification_terms_accept_failed",
		details: { organization_id: organizationId },
		error: result.error,
		event: "organizations.verification_terms.accept.failed",
		message: "Failed to record verification terms acceptance.",
		status: 500,
	});
	return recordFailedResponse(c);
};
