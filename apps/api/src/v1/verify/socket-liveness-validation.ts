import type { VerifyServerCheckResult } from "@kayle-id/capnp/verify-codec";
import { logEvent } from "@kayle-id/config/logging";
import {
	type LivenessVerificationResult,
	verifyLiveness,
} from "./biometric-verifier-client";
import { resolveFaceMatchThresholdFromDg1 } from "./dg1-claims";
import {
	completeCheckWithNegativeSignal,
	confirmedCheckResult,
	sendCheckResultAndMaybeClose,
} from "./socket-check-result";
import type { VerifySocketContext } from "./socket-context";

export function shouldRejectSuccessfulFallbackMatch({
	result,
	nodeEnv = process.env.NODE_ENV,
}: {
	result: LivenessVerificationResult;
	nodeEnv?: string;
}): boolean {
	return (
		nodeEnv === "production" && result.faceMatchPassed && result.usedFallback
	);
}

export async function runLivenessPhaseValidation({
	context,
	sessionId,
}: {
	context: VerifySocketContext;
	sessionId: string;
}): Promise<VerifyServerCheckResult | null> {
	const documentPortrait = context.state.transfer.dg2;
	const livenessVideo = context.state.transfer.livenessVideo;
	if (!(documentPortrait && livenessVideo)) {
		return null;
	}

	const thresholdResult = resolveFaceMatchThreshold(context, sessionId);

	if (!thresholdResult.ok) {
		const checkResult = await completeCheckWithNegativeSignal({
			code: "document_data_invalid",
			context,
			riskScore: 1,
		});
		context.log.set({
			event: "verify.ws.not_confirmed",
			failure_code: checkResult.reasonCode,
			face_match_threshold_reason: thresholdResult.reason,
			retry_allowed: checkResult.retryAllowed,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	const challengeNonce = context.state.livenessChallengeNonce;
	if (!challengeNonce) {
		logEvent(context.log, {
			details: { session_id: sessionId },
			event: "verify.ws.liveness_challenge_nonce_missing",
			level: "warn",
		});
		const checkResult = await completeCheckWithNegativeSignal({
			code: "liveness_failed",
			context,
			riskScore: 1,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	const result = await verifyLiveness({
		dg2Image: documentPortrait,
		video: livenessVideo,
		challengeNonce,
		faceMatchThreshold: thresholdResult.threshold,
		env: context.env,
		organizationId: context.session.organizationId,
		sessionId,
		logger: context.log,
	});
	logEvent(context.log, {
		details: {
			session_id: sessionId,
			face_match_passed: result.faceMatchPassed,
			face_match_score: result.faceMatchScore,
			face_match_threshold: thresholdResult.threshold,
			liveness_passed: result.livenessPassed,
			liveness_score: result.livenessScore,
			pad_passed: result.padPassed,
			pad_score: result.padScore,
			reason: result.reason ?? null,
			used_fallback: result.usedFallback,
		},
		event: "verify.ws.liveness_evaluated",
	});

	return resolveLivenessCheckResult(context, sessionId, result);
}

async function resolveLivenessCheckResult(
	context: VerifySocketContext,
	sessionId: string,
	result: LivenessVerificationResult,
): Promise<VerifyServerCheckResult> {
	if (!result.livenessPassed) {
		const checkResult = await completeCheckWithNegativeSignal({
			code: "liveness_failed",
			context,
			riskScore: 1,
		});
		context.log.set({
			event: "verify.ws.not_confirmed",
			failure_code: checkResult.reasonCode,
			liveness_reason: result.reason ?? null,
			liveness_score: result.livenessScore,
			retry_allowed: checkResult.retryAllowed,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	if (!result.padPassed) {
		const checkResult = await completeCheckWithNegativeSignal({
			code: "liveness_failed",
			context,
			riskScore: 1,
		});
		context.log.set({
			event: "verify.ws.not_confirmed",
			failure_code: checkResult.reasonCode,
			liveness_reason: result.reason ?? null,
			pad_score: result.padScore,
			retry_allowed: checkResult.retryAllowed,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	if (
		!result.faceMatchPassed ||
		shouldRejectSuccessfulFallbackMatch({ result })
	) {
		if (result.faceMatchPassed && result.usedFallback) {
			logEvent(context.log, {
				details: {
					session_id: sessionId,
					face_match_score: result.faceMatchScore,
					node_env: process.env.NODE_ENV ?? null,
				},
				event: "verify.ws.fallback_confirm_blocked",
				level: "warn",
			});
		}

		const checkResult = await completeCheckWithNegativeSignal({
			code: "selfie_face_mismatch",
			context,
			riskScore: result.usedFallback ? 1 : 1 - (result.faceMatchScore ?? 0),
		});
		context.log.set({
			event: "verify.ws.not_confirmed",
			failure_code: checkResult.reasonCode,
			retry_allowed: checkResult.retryAllowed,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return checkResult;
	}

	if (typeof result.faceMatchScore !== "number") {
		throw new Error("face_score_required_for_success");
	}

	context.state.confirmedFaceScore = result.faceMatchScore;
	return confirmedCheckResult();
}

type FaceMatchThresholdResult =
	| { ok: true; threshold: number }
	| { ok: false; reason: "dg1_missing" | "dg1_parse_failed" };

function resolveFaceMatchThreshold(
	context: VerifySocketContext,
	sessionId: string,
): FaceMatchThresholdResult {
	const dg1 = context.state.transfer.dg1;

	if (!dg1) {
		logEvent(context.log, {
			details: { session_id: sessionId },
			event: "verify.ws.face_match_threshold_dg1_missing",
			level: "warn",
		});
		return { ok: false, reason: "dg1_missing" };
	}

	try {
		return {
			ok: true,
			threshold: resolveFaceMatchThresholdFromDg1({
				dg1,
				now: new Date(),
			}),
		};
	} catch (error) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				error:
					error instanceof Error
						? error.message
						: "face_match_threshold_invalid",
			},
			event: "verify.ws.face_match_threshold_dg1_parse_failed",
			level: "warn",
		});
		return { ok: false, reason: "dg1_parse_failed" };
	}
}
