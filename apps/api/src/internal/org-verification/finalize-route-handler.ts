import type { RouteHandler } from "@hono/zod-openapi";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import {
	alreadyVerifiedResponse,
	documentConflictResponse,
	frozenOrganizationResponse,
	internalServerErrorResponse,
	organizationNotFoundResponse,
	ownerNotActiveResponse,
	verifiedResponse,
} from "./finalize-responses";
import type { finalizeOrgVerificationRoute } from "./finalize-route";
import {
	finalizePreparedOrgVerification,
	inputFromFinalizeBody,
	loadFinalizeTarget,
} from "./finalize-service";
import type { FinalizeOrgVerificationInput } from "./finalize-types";
import { prepareOrgVerificationRecord } from "./records-repo";

type FinalizeAppEnv = { Bindings: CloudflareBindings };

function logIdempotentFinalize(
	log: ReturnType<typeof getRequestLogger>,
	organizationId: string,
): void {
	logEvent(log, {
		details: { organization_id: organizationId, already_verified: true },
		event: "org_verifications.finalize.idempotent",
	});
}

async function prepareRecordOrRespond(
	c: Parameters<
		RouteHandler<typeof finalizeOrgVerificationRoute, FinalizeAppEnv>
	>[0],
	log: ReturnType<typeof getRequestLogger>,
	input: FinalizeOrgVerificationInput,
) {
	try {
		return await prepareOrgVerificationRecord(
			{
				organizationId: input.organizationId,
				documentType: input.documentType,
				documentNumber: input.documentNumber,
				issuingCountry: input.issuingCountry,
			},
			process.env as Record<string, string | undefined>,
		);
	} catch (error) {
		logSafeError(log, {
			code: "org_verification_record_failed",
			details: { organization_id: input.organizationId },
			error,
			event: "org_verifications.finalize.record_failed",
			message: "Failed to record org verification.",
			status: 500,
		});
		return internalServerErrorResponse(c);
	}
}

export const finalizeOrgVerificationHandler: RouteHandler<
	typeof finalizeOrgVerificationRoute,
	FinalizeAppEnv
> = async (c) => {
	const log = getRequestLogger(c);
	const input = inputFromFinalizeBody(c.req.valid("json"));
	const target = await loadFinalizeTarget(input.organizationId);

	if (target.kind === "not_found") {
		return organizationNotFoundResponse(c);
	}

	if (target.kind === "already_verified") {
		logIdempotentFinalize(log, target.organizationId);
		return alreadyVerifiedResponse(c, target.verifiedAt);
	}

	if (target.kind === "frozen") {
		return frozenOrganizationResponse(c);
	}

	const preparedRecord = await prepareRecordOrRespond(c, log, input);
	if ("status" in preparedRecord) {
		return preparedRecord;
	}

	const finalizeResult = await finalizePreparedOrgVerification({
		input,
		preparedRecord,
		now: new Date(),
	});

	if (finalizeResult.kind === "already_verified") {
		logIdempotentFinalize(log, input.organizationId);
		return alreadyVerifiedResponse(c, finalizeResult.verifiedAt);
	}

	if (finalizeResult.kind === "frozen") {
		return frozenOrganizationResponse(c);
	}

	if (finalizeResult.kind === "owner_not_active") {
		return ownerNotActiveResponse(c);
	}

	if (finalizeResult.kind === "document_conflict") {
		logEvent(log, {
			details: {
				organization_id: input.organizationId,
				record_organization_id: finalizeResult.recordOrganizationId,
			},
			event: "org_verifications.finalize.document_conflict",
		});
		return documentConflictResponse(c);
	}

	logEvent(log, {
		details: {
			organization_id: input.organizationId,
			record_id: finalizeResult.recordId,
			pepper_version: finalizeResult.pepperVersion,
		},
		event: "org_verifications.finalize.completed",
	});

	return verifiedResponse(c, finalizeResult);
};
