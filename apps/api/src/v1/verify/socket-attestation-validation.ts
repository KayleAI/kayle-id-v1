import type { VerifyServerCheckResult } from "@kayle-id/capnp/verify-codec";
import { logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { isAttestationGateEnabled, verifyNfcAttestation } from "./attest-gate";
import {
	completeCheckWithNegativeSignal,
	sendCheckResultAndMaybeClose,
} from "./socket-check-result";
import type { VerifySocketContext } from "./socket-context";

export async function runAttestationValidation({
	sessionId,
	context,
}: {
	sessionId: string;
	context: VerifySocketContext;
}): Promise<VerifyServerCheckResult | null> {
	if (!isAttestationGateEnabled(context.env)) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				assertion_present:
					(context.state.transfer.nfcAttestAssertion?.length ?? 0) > 0,
			},
			event: "verify.ws.attest_gate_skipped",
		});
		return null;
	}

	const [sessionRow] = await db
		.select({ mobileAttestKeyId: verification_sessions.mobileAttestKeyId })
		.from(verification_sessions)
		.where(eq(verification_sessions.id, context.session.id))
		.limit(1);
	const attestKeyId = sessionRow?.mobileAttestKeyId ?? null;

	if (!attestKeyId) {
		logEvent(context.log, {
			details: { session_id: sessionId, reason: "key_missing_on_attempt" },
			event: "verify.ws.attest_failed",
			level: "warn",
		});

		const checkResult = await completeCheckWithNegativeSignal({
			code: "document_anti_cloning_attestation_failed",
			context,
			riskScore: 1,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	const result = await verifyNfcAttestation({
		sessionId,
		attestKeyId,
		authSecret: context.env.AUTH_SECRET as string,
		transfer: context.state.transfer,
	});

	if (result.ok) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				attest_key_id: attestKeyId,
				attest_counter: result.counter,
			},
			event: "verify.ws.attest_succeeded",
		});
		return null;
	}

	logEvent(context.log, {
		details: {
			session_id: sessionId,
			attest_key_id: attestKeyId,
			reason: result.code,
			detail: result.detail ?? null,
		},
		event: "verify.ws.attest_failed",
		level: "warn",
	});

	const checkResult = await completeCheckWithNegativeSignal({
		code: "document_anti_cloning_attestation_failed",
		context,
		riskScore: 1,
	});
	sendCheckResultAndMaybeClose(context, checkResult);
	return checkResult;
}
