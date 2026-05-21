import type { VerifyServerCheckResult } from "@kayle-id/capnp/verify-codec";
import { logEvent } from "@kayle-id/config/logging";
import {
	completeCheckWithNegativeSignal,
	sendCheckResultAndMaybeClose,
} from "./socket-check-result";
import type { VerifySocketContext } from "./socket-context";
import {
	deriveActiveAuthChallenge,
	validateActiveAuthentication,
} from "./validation";
import type { ActiveAuthValidationResult } from "./validation-types";

export async function runActiveAuthValidation({
	sessionId,
	context,
	sodDeclaresDg15,
}: {
	sessionId: string;
	context: VerifySocketContext;
	sodDeclaresDg15: boolean;
}): Promise<VerifyServerCheckResult | null> {
	if (!sodDeclaresDg15) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				reason: "sod_no_dg15",
			},
			event: "verify.ws.active_auth_skipped",
		});
		return null;
	}

	const { activeAuthChallenge, activeAuthSignature, dg14, dg15 } =
		context.state.transfer;

	if (!(dg15 && activeAuthChallenge && activeAuthSignature)) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				reason: "active_auth_artifacts_missing",
			},
			event: "verify.ws.active_auth_failed",
		});

		const checkResult = await completeCheckWithNegativeSignal({
			code: "document_active_authentication_failed",
			context,
			riskScore: 1,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	const expectedChallenge = await deriveActiveAuthChallenge({
		sessionId,
		authSecret: context.env.AUTH_SECRET as string,
	});
	const result: ActiveAuthValidationResult = await validateActiveAuthentication(
		{
			challenge: activeAuthChallenge,
			dg14,
			dg15,
			expectedChallenge,
			signature: activeAuthSignature,
		},
	);

	if (result.ok) {
		logEvent(context.log, {
			details: {
				active_auth_algorithm: result.algorithm,
				active_auth_hash_algorithm: result.hashAlgorithm,
				session_id: sessionId,
			},
			event: "verify.ws.active_auth_succeeded",
		});
		return null;
	}

	logEvent(context.log, {
		details: {
			active_auth_detail: result.detail ?? null,
			active_auth_reason: result.reason,
			session_id: sessionId,
		},
		event: "verify.ws.active_auth_failed",
	});

	const checkResult = await completeCheckWithNegativeSignal({
		code: "document_active_authentication_failed",
		context,
		riskScore: 1,
	});
	sendCheckResultAndMaybeClose(context, checkResult);
	return checkResult;
}
