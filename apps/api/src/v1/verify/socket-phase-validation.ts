import { logEvent } from "@kayle-id/config/logging";
import { attemptWebhookDelivery } from "@/v1/webhooks/deliveries/service";
import { getNfcTransferStatus, getSelfieTransferStatus } from "./data-payload";
import { resolveFaceMatchThresholdFromDg1 } from "./dg1-claims";
import { parseDg14 } from "./dg14-parser";
import { resolveVerifyErrorMessage } from "./error-response";
import { matchFaces } from "./face-matcher-client";
import { MAX_FAILED_ATTEMPTS, markAttemptFailed } from "./outcome";
import type { VerifySocketContext } from "./socket-context";
import {
	deriveActiveAuthChallenge,
	validateActiveAuthentication,
	validateAuthenticity,
	validateChipAuthentication,
} from "./validation";
import {
	type ActiveAuthValidationResult,
	type ChipAuthValidationResult,
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
	code:
		| "passport_authenticity_failed"
		| "passport_active_authentication_failed"
		| "passport_chip_authentication_failed"
		| "selfie_face_mismatch";
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

async function runActiveAuthValidation({
	attemptId,
	context,
	sodDeclaresDg15,
}: {
	attemptId: string;
	context: VerifySocketContext;
	sodDeclaresDg15: boolean;
}) {
	if (!sodDeclaresDg15) {
		logEvent(context.log, {
			details: {
				attempt_id: attemptId,
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
				attempt_id: attemptId,
				reason: "active_auth_artifacts_missing",
			},
			event: "verify.ws.active_auth_failed",
		});

		const verdict = await rejectAttemptWithVerdict({
			attemptId,
			code: "passport_active_authentication_failed",
			context,
			riskScore: 1,
		});
		context.transport.sendVerdict(verdict);
		context.transport.closeAfterVerdict(verdict.reasonCode);
		return verdict;
	}

	const expectedChallenge = await deriveActiveAuthChallenge({
		attemptId,
		authSecret: context.env.AUTH_SECRET,
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
				attempt_id: attemptId,
			},
			event: "verify.ws.active_auth_succeeded",
		});
		return null;
	}

	logEvent(context.log, {
		details: {
			active_auth_detail: result.detail ?? null,
			active_auth_reason: result.reason,
			attempt_id: attemptId,
		},
		event: "verify.ws.active_auth_failed",
	});

	const verdict = await rejectAttemptWithVerdict({
		attemptId,
		code: "passport_active_authentication_failed",
		context,
		riskScore: 1,
	});
	context.transport.sendVerdict(verdict);
	context.transport.closeAfterVerdict(verdict.reasonCode);
	return verdict;
}

function dg14HasChipAuth(dg14: Uint8Array | undefined): boolean {
	if (!dg14 || dg14.length === 0) {
		return false;
	}

	try {
		return parseDg14(dg14).chipAuthInfos.length > 0;
	} catch {
		// Treat parse failures as "no CA declared" — PA already enforces SOD ↔
		// DG14 binding for declared DG14, so if the bytes are unreadable PA will
		// reject before we get here.
		return false;
	}
}

async function runChipAuthValidation({
	attemptId,
	context,
	sodDeclaresDg14,
}: {
	attemptId: string;
	context: VerifySocketContext;
	sodDeclaresDg14: boolean;
}) {
	const { chipAuthTranscript, dg14 } = context.state.transfer;

	if (!sodDeclaresDg14) {
		logEvent(context.log, {
			details: {
				attempt_id: attemptId,
				reason: "sod_no_dg14",
			},
			event: "verify.ws.chip_auth_skipped",
		});
		return null;
	}

	if (!dg14HasChipAuth(dg14)) {
		logEvent(context.log, {
			details: {
				attempt_id: attemptId,
				reason: "dg14_has_no_chip_auth",
			},
			event: "verify.ws.chip_auth_skipped",
		});
		return null;
	}

	if (!(dg14 && chipAuthTranscript)) {
		logEvent(context.log, {
			details: {
				attempt_id: attemptId,
				reason: "chip_auth_artifacts_missing",
			},
			event: "verify.ws.chip_auth_failed",
		});

		const verdict = await rejectAttemptWithVerdict({
			attemptId,
			code: "passport_chip_authentication_failed",
			context,
			riskScore: 1,
		});
		context.transport.sendVerdict(verdict);
		context.transport.closeAfterVerdict(verdict.reasonCode);
		return verdict;
	}

	const result: ChipAuthValidationResult = await validateChipAuthentication({
		chipAuthData: chipAuthTranscript,
		dg14,
	});

	if (result.ok) {
		logEvent(context.log, {
			details: {
				attempt_id: attemptId,
				chip_auth_algorithm: result.algorithm,
				chip_auth_key_agreement: result.keyAgreement,
			},
			event: "verify.ws.chip_auth_succeeded",
		});
		return null;
	}

	logEvent(context.log, {
		details: {
			attempt_id: attemptId,
			chip_auth_detail: result.detail ?? null,
			chip_auth_reason: result.reason,
		},
		event: "verify.ws.chip_auth_failed",
	});

	const verdict = await rejectAttemptWithVerdict({
		attemptId,
		code: "passport_chip_authentication_failed",
		context,
		riskScore: 1,
	});
	context.transport.sendVerdict(verdict);
	context.transport.closeAfterVerdict(verdict.reasonCode);
	return verdict;
}

export async function runPhaseValidation(
	context: VerifySocketContext,
	attemptId: string,
	nextPhase: "nfc_complete" | "selfie_complete",
) {
	if (nextPhase === "nfc_complete") {
		const { dg1, dg2, dg14, dg15, sod } = context.state.transfer;

		if (!(dg1 && dg2 && sod)) {
			return null;
		}

		const authenticity = await validateAuthenticity({
			dg1,
			dg2,
			dg14,
			dg15,
			sod,
		});
		if (!authenticity.ok) {
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

		const chipAuthVerdict = await runChipAuthValidation({
			attemptId,
			context,
			sodDeclaresDg14: authenticity.sodDeclares.dg14,
		});

		if (chipAuthVerdict) {
			return chipAuthVerdict;
		}

		return await runActiveAuthValidation({
			attemptId,
			context,
			sodDeclaresDg15: authenticity.sodDeclares.dg15,
		});
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
