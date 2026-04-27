import { logEvent } from "@kayle-id/config/logging";
import { attemptWebhookDelivery } from "@/v1/webhooks/deliveries/service";
import { getNfcTransferStatus, getSelfieTransferStatus } from "./data-payload";
import { resolveFaceMatchThresholdFromDg1 } from "./dg1-claims";
import { resolveVerifyErrorMessage } from "./error-response";
import { matchFaces } from "./face-matcher-client";
import { MAX_FAILED_ATTEMPTS, markAttemptFailed } from "./outcome";
import type { VerifySocketContext } from "./socket-context";
import { validateAuthenticity } from "./validation";
import {
	DEFAULT_FACE_MATCH_THRESHOLD,
	type FaceScoreResult,
} from "./validation-types";

export function shouldRejectSuccessfulFallbackMatch({
	faceResult,
	nodeEnv = process.env.NODE_ENV,
}: {
	faceResult: FaceScoreResult;
	nodeEnv?: string;
}): boolean {
	return (
		nodeEnv === "production" && faceResult.passed && faceResult.usedFallback
	);
}

export function buildMissingDataMessage(
	context: VerifySocketContext,
	nextPhase: string,
): {
	code: "NFC_REQUIRED_DATA_MISSING" | "SELFIE_REQUIRED_DATA_MISSING";
	message: string;
} | null {
	if (nextPhase === "nfc_complete") {
		const status = getNfcTransferStatus(context.state.transfer);

		return status.complete
			? null
			: {
					code: "NFC_REQUIRED_DATA_MISSING",
					message: JSON.stringify({
						missing_artifacts: status.missingArtifacts,
						missing_chunks: status.missingChunks.map((chunk) => ({
							kind: chunk.kind,
							index: chunk.index,
							chunk_total: chunk.chunkTotal,
							missing_chunk_indices: chunk.missingChunkIndices,
						})),
					}),
				};
	}

	if (nextPhase !== "selfie_complete") {
		return null;
	}

	const status = getSelfieTransferStatus(context.state.transfer);

	return status.complete
		? null
		: {
				code: "SELFIE_REQUIRED_DATA_MISSING",
				message: JSON.stringify({
					required_total: status.requiredTotal,
					missing_selfie_indexes: status.missingSelfieIndexes,
					missing_chunks: status.missingChunks.map((chunk) => ({
						kind: chunk.kind,
						index: chunk.index,
						chunk_total: chunk.chunkTotal,
						missing_chunk_indices: chunk.missingChunkIndices,
					})),
				}),
			};
}

async function rejectAttemptWithVerdict({
	attemptId,
	code,
	context,
	riskScore,
}: {
	attemptId: string;
	code: "passport_authenticity_failed" | "selfie_face_mismatch";
	context: VerifySocketContext;
	riskScore: number;
}) {
	const result = await markAttemptFailed({
		session: context.session,
		attemptId,
		failureCode: code,
		riskScore,
	});

	if (result.deliveryIds.length > 0) {
		context.scheduleTask(
			(async () => {
				for (const deliveryId of result.deliveryIds) {
					await attemptWebhookDelivery({
						authSecret: context.env.AUTH_SECRET,
						deliveryId,
					});
				}
			})(),
		);
	}

	return {
		outcome: "rejected" as const,
		reasonCode: code,
		reasonMessage: resolveVerifyErrorMessage(code),
		retryAllowed: !result.terminalized,
		remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - result.failedAttempts),
	};
}

async function resolveSelfieVerdict(
	context: VerifySocketContext,
	attemptId: string,
	faceResult: FaceScoreResult,
) {
	if (
		!faceResult.passed ||
		shouldRejectSuccessfulFallbackMatch({ faceResult })
	) {
		if (faceResult.passed && faceResult.usedFallback) {
			logEvent(context.log, {
				details: {
					attempt_id: attemptId,
					face_score: faceResult.faceScore,
					node_env: process.env.NODE_ENV ?? null,
				},
				event: "verify.ws.fallback_accept_blocked",
				level: "warn",
			});
		}

		const verdict = await rejectAttemptWithVerdict({
			attemptId,
			code: "selfie_face_mismatch",
			context,
			riskScore: faceResult.usedFallback ? 1 : 1 - (faceResult.faceScore ?? 0),
		});
		context.log.set({
			event: "verify.ws.rejected",
			failure_code: verdict.reasonCode,
			remaining_attempts: verdict.remainingAttempts,
			retry_allowed: verdict.retryAllowed,
		});
		context.transport.sendVerdict(verdict);
		context.transport.closeAfterVerdict(verdict.reasonCode);
		return verdict;
	}

	if (typeof faceResult.faceScore !== "number") {
		throw new Error("face_score_required_for_success");
	}

	context.state.acceptedFaceScore = faceResult.faceScore;
	return {
		outcome: "accepted" as const,
		reasonCode: "",
		reasonMessage: "",
		retryAllowed: false,
		remainingAttempts: 0,
	};
}

function resolveSelfieMatchThreshold(
	context: VerifySocketContext,
	attemptId: string,
): number {
	const dg1 = context.state.transfer.dg1;

	if (!dg1) {
		return DEFAULT_FACE_MATCH_THRESHOLD;
	}

	try {
		return resolveFaceMatchThresholdFromDg1({
			dg1,
			now: new Date(),
		});
	} catch (error) {
		logEvent(context.log, {
			details: {
				attempt_id: attemptId,
				error:
					error instanceof Error
						? error.message
						: "face_match_threshold_invalid",
			},
			event: "verify.ws.face_match_threshold_defaulted",
			level: "warn",
		});

		return DEFAULT_FACE_MATCH_THRESHOLD;
	}
}

export async function runPhaseValidation(
	context: VerifySocketContext,
	attemptId: string,
	nextPhase: "nfc_complete" | "selfie_complete",
) {
	if (nextPhase === "nfc_complete") {
		const { dg1, dg2, sod } = context.state.transfer;

		if (!(dg1 && dg2 && sod)) {
			return null;
		}

		const authenticity = await validateAuthenticity({ dg1, dg2, sod });
		if (authenticity.ok) {
			return null;
		}

		logEvent(context.log, {
			details: {
				attempt_id: attemptId,
				crl_status: authenticity.crlStatus,
				passive_auth_detail: authenticity.detail ?? null,
				passive_auth_reason: authenticity.reason,
				signer_source: authenticity.signerSource,
			},
			event: "verify.ws.passive_auth_failed",
		});

		const verdict = await rejectAttemptWithVerdict({
			attemptId,
			code: "passport_authenticity_failed",
			context,
			riskScore: 1,
		});
		context.transport.sendVerdict(verdict);
		context.transport.closeAfterVerdict(verdict.reasonCode);
		return verdict;
	}

	const documentPortrait = context.state.transfer.dg2;
	if (!documentPortrait) {
		return null;
	}

	const threshold = resolveSelfieMatchThreshold(context, attemptId);

	const result = await matchFaces({
		dg2Image: documentPortrait,
		selfies: Array.from(context.state.transfer.selfies.values()),
		threshold,
		env: context.env,
		attemptId,
		logger: context.log,
	});
	logEvent(context.log, {
		details: {
			attempt_id: attemptId,
			face_score: result.faceScore,
			face_match_threshold: threshold,
			passed: result.passed,
			reason: result.reason ?? null,
			used_fallback: result.usedFallback,
		},
		event: "verify.ws.face_score_evaluated",
	});

	return resolveSelfieVerdict(context, attemptId, result);
}
