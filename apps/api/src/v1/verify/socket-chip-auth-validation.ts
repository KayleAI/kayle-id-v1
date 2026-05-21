import type { VerifyServerCheckResult } from "@kayle-id/capnp/verify-codec";
import { logEvent } from "@kayle-id/config/logging";
import {
	completeCheckWithNegativeSignal,
	sendCheckResultAndMaybeClose,
} from "./socket-check-result";
import {
	chipAuthSummaryDetails,
	summarizeDg14ChipAuth,
} from "./socket-chip-auth-summary";
import type { VerifySocketContext } from "./socket-context";
import { validateChipAuthentication } from "./validation";
import type { ChipAuthValidationResult } from "./validation-types";

export async function runChipAuthValidation({
	sessionId,
	context,
	sodDeclaresDg14,
}: {
	sessionId: string;
	context: VerifySocketContext;
	sodDeclaresDg14: boolean;
}): Promise<VerifyServerCheckResult | null> {
	const { chipAuthTranscript, dg14 } = context.state.transfer;

	if (!sodDeclaresDg14) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				reason: "sod_no_dg14",
			},
			event: "verify.ws.chip_auth_skipped",
		});
		return null;
	}

	const summary = summarizeDg14ChipAuth(dg14);

	if (summary.declaration === "none") {
		logChipAuthSkipped({
			context,
			reason: "dg14_has_no_chip_auth",
			sessionId,
			transcriptUploaded: chipAuthTranscript !== undefined,
			summary,
		});
		return null;
	}

	if (summary.declaration === "v1_only") {
		logChipAuthSkipped({
			context,
			reason: "dg14_v1_only",
			sessionId,
			transcriptUploaded: chipAuthTranscript !== undefined,
			summary,
		});
		return null;
	}

	if (!(dg14 && chipAuthTranscript)) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				...chipAuthSummaryDetails(summary),
				reason: "chip_auth_artifacts_missing",
			},
			event: "verify.ws.chip_auth_failed",
		});

		const checkResult = await completeCheckWithNegativeSignal({
			code: "document_chip_authentication_failed",
			context,
			riskScore: 1,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	const result: ChipAuthValidationResult = await validateChipAuthentication({
		chipAuthData: chipAuthTranscript,
		dg14,
	});

	if (result.ok) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				chip_auth_algorithm: result.algorithm,
				chip_auth_key_agreement: result.keyAgreement,
				...chipAuthSummaryDetails(summary),
				transcript_byte_count: chipAuthTranscript.length,
			},
			event: "verify.ws.chip_auth_succeeded",
		});
		return null;
	}

	logEvent(context.log, {
		details: {
			session_id: sessionId,
			...chipAuthSummaryDetails(summary),
			chip_auth_detail: result.detail ?? null,
			chip_auth_reason: result.reason,
			transcript_byte_count: chipAuthTranscript.length,
		},
		event: "verify.ws.chip_auth_failed",
	});

	const checkResult = await completeCheckWithNegativeSignal({
		code: "document_chip_authentication_failed",
		context,
		riskScore: 1,
	});
	sendCheckResultAndMaybeClose(context, checkResult);
	return checkResult;
}

function logChipAuthSkipped({
	context,
	reason,
	sessionId,
	transcriptUploaded,
	summary,
}: {
	context: VerifySocketContext;
	reason: "dg14_has_no_chip_auth" | "dg14_v1_only";
	sessionId: string;
	transcriptUploaded: boolean;
	summary: ReturnType<typeof summarizeDg14ChipAuth>;
}): void {
	logEvent(context.log, {
		details: {
			session_id: sessionId,
			...chipAuthSummaryDetails(summary),
			reason,
			transcript_uploaded: transcriptUploaded,
		},
		event: "verify.ws.chip_auth_skipped",
	});
}
