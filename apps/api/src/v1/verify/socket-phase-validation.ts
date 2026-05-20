import { logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { triggerWebhookDeliveryWorkflows } from "@/v1/webhooks/deliveries/service";
import { isAttestationGateEnabled, verifyNfcAttestation } from "./attest-gate";
import {
	type LivenessVerificationResult,
	verifyLiveness,
} from "./biometric-verifier-client";
import {
	getLivenessTransferStatus,
	getNfcTransferStatus,
} from "./data-payload";
import { resolveFaceMatchThresholdFromDg1 } from "./dg1-claims";
import { parseDg14 } from "./dg14-parser";
import { resolveVerifyErrorMessage } from "./error-response";
import { markCheckFailed } from "./outcome";
import {
	failedCheckForCode,
	MAX_LIVENESS_RETRIES,
	MAX_NFC_RETRIES,
	type NegativeFailureCode,
} from "./retry-limits";
import type { VerifySocketContext } from "./socket-context";
import {
	deriveActiveAuthChallenge,
	validateActiveAuthentication,
	validateAuthenticity,
	validateChipAuthentication,
} from "./validation";
import type {
	ActiveAuthValidationResult,
	ChipAuthValidationResult,
} from "./validation-types";

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

export function buildMissingDataMessage(
	context: VerifySocketContext,
	nextPhase: string,
): {
	code: "NFC_REQUIRED_DATA_MISSING" | "LIVENESS_REQUIRED_DATA_MISSING";
	message: string;
} | null {
	if (nextPhase === "nfc_complete") {
		const status = getNfcTransferStatus(context.state.transfer);
		return status.complete ? null : buildMissingNfcDataMessage(status);
	}

	if (nextPhase !== "liveness_complete") {
		return null;
	}

	// Face matching needs dg2 from the NFC scan, but the transfer state is
	// per-socket — on reconnect the prior socket's chunks are gone. Catch the
	// missing-NFC case here and surface it so the client can re-stream,
	// instead of letting runPhaseValidation silently early-return null and
	// the phase machinery advance to liveness_complete with no validation.
	const nfcStatus = getNfcTransferStatus(context.state.transfer);
	if (!nfcStatus.complete) {
		return buildMissingNfcDataMessage(nfcStatus);
	}

	const status = getLivenessTransferStatus(context.state.transfer);

	return status.complete
		? null
		: {
				code: "LIVENESS_REQUIRED_DATA_MISSING",
				message: JSON.stringify({
					received_bytes: status.receivedBytes,
					missing_chunks: status.missingChunks.map((chunk) => ({
						kind: chunk.kind,
						index: chunk.index,
						chunk_total: chunk.chunkTotal,
						missing_chunk_indices: chunk.missingChunkIndices,
					})),
				}),
			};
}

function buildMissingNfcDataMessage(
	status: ReturnType<typeof getNfcTransferStatus>,
): { code: "NFC_REQUIRED_DATA_MISSING"; message: string } {
	return {
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

async function completeCheckWithNegativeSignal({
	code,
	context,
	riskScore,
}: {
	code: NegativeFailureCode;
	context: VerifySocketContext;
	riskScore: number;
}) {
	const result = await markCheckFailed({
		session: context.session,
		failureCode: code,
		riskScore,
	});

	if (result.deliveryIds.length > 0) {
		context.scheduleTask(
			triggerWebhookDeliveryWorkflows({
				env: context.env,
				deliveryIds: result.deliveryIds,
			}),
		);
	}

	const failedCheck = failedCheckForCode(code);

	return {
		outcome: "not_confirmed" as const,
		reasonCode: code,
		reasonMessage: resolveVerifyErrorMessage(code),
		retryAllowed: !result.terminalized,
		failedCheck,
		remainingNfcRetries: result.remainingNfcRetries,
		remainingLivenessRetries: result.remainingLivenessRetries,
	};
}

async function resolveLivenessCheckResult(
	context: VerifySocketContext,
	sessionId: string,
	result: LivenessVerificationResult,
) {
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
		return checkResult;
	}

	// PAD gate. Movement coverage already passed, so a PAD failure here
	// means the clip looks animate but the model thinks it's a spoof
	// (printed photo, screen replay, mask, etc.). Treated as a liveness
	// failure for the user-visible checkResult so the messaging stays
	// consistent; the specific `pad_*` reason survives in telemetry.
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
		return checkResult;
	}

	if (typeof result.faceMatchScore !== "number") {
		throw new Error("face_score_required_for_success");
	}

	context.state.confirmedFaceScore = result.faceMatchScore;
	return {
		outcome: "confirmed" as const,
		reasonCode: "",
		reasonMessage: "",
		retryAllowed: false,
		failedCheck: "none" as const,
		remainingNfcRetries: MAX_NFC_RETRIES,
		remainingLivenessRetries: MAX_LIVENESS_RETRIES,
	};
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

async function runActiveAuthValidation({
	sessionId,
	context,
	sodDeclaresDg15,
}: {
	sessionId: string;
	context: VerifySocketContext;
	sodDeclaresDg15: boolean;
}) {
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
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
	context.transport.sendCheckResult(checkResult);
	if (!checkResult.retryAllowed) {
		context.transport.closeAfterCheckResult(checkResult.reasonCode);
	}
	return checkResult;
}

type Dg14ChipAuthSummary = {
	declaration: "none" | "v1_only" | "v2";
	chipAuthInfoCount: number;
	chipAuthInfoVersions: number[];
	chipAuthInfoOids: string[];
	chipAuthPublicKeyCount: number;
	chipAuthPublicKeyOids: string[];
};

function summarizeDg14ChipAuth(
	dg14: Uint8Array | undefined,
): Dg14ChipAuthSummary {
	const empty: Dg14ChipAuthSummary = {
		declaration: "none",
		chipAuthInfoCount: 0,
		chipAuthInfoVersions: [],
		chipAuthInfoOids: [],
		chipAuthPublicKeyCount: 0,
		chipAuthPublicKeyOids: [],
	};

	if (!dg14 || dg14.length === 0) {
		return empty;
	}

	try {
		const parsed = parseDg14(dg14);
		const infos = parsed.chipAuthInfos;
		const declaration: Dg14ChipAuthSummary["declaration"] = (() => {
			if (infos.length === 0) return "none";
			return infos.some((info) => info.version >= 2) ? "v2" : "v1_only";
		})();

		return {
			declaration,
			chipAuthInfoCount: infos.length,
			chipAuthInfoVersions: infos.map((info) => info.version),
			chipAuthInfoOids: infos.map((info) => info.algorithm.oid),
			chipAuthPublicKeyCount: parsed.chipAuthPublicKeys.length,
			chipAuthPublicKeyOids: parsed.chipAuthPublicKeys.map(
				(entry) => entry.algorithmOid,
			),
		};
	} catch {
		// PA already enforces SOD ↔ DG14 binding for declared DG14, so if the
		// bytes are unreadable PA will reject before we get here.
		return empty;
	}
}

function chipAuthSummaryDetails(summary: Dg14ChipAuthSummary) {
	return {
		dg14_chip_auth_declaration: summary.declaration,
		dg14_chip_auth_info_count: summary.chipAuthInfoCount,
		dg14_chip_auth_info_oids: summary.chipAuthInfoOids,
		dg14_chip_auth_info_versions: summary.chipAuthInfoVersions,
		dg14_chip_auth_public_key_count: summary.chipAuthPublicKeyCount,
		dg14_chip_auth_public_key_oids: summary.chipAuthPublicKeyOids,
	};
}

async function runChipAuthValidation({
	sessionId,
	context,
	sodDeclaresDg14,
}: {
	sessionId: string;
	context: VerifySocketContext;
	sodDeclaresDg14: boolean;
}) {
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
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				...chipAuthSummaryDetails(summary),
				reason: "dg14_has_no_chip_auth",
				transcript_uploaded: chipAuthTranscript !== undefined,
			},
			event: "verify.ws.chip_auth_skipped",
		});
		return null;
	}

	if (summary.declaration === "v1_only") {
		// CA-v1 chips only restart secure messaging; they never return a chip
		// token to verify server-side. Skip and let any subsequent AA path run.
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				...chipAuthSummaryDetails(summary),
				reason: "dg14_v1_only",
				transcript_uploaded: chipAuthTranscript !== undefined,
			},
			event: "verify.ws.chip_auth_skipped",
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
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
	context.transport.sendCheckResult(checkResult);
	if (!checkResult.retryAllowed) {
		context.transport.closeAfterCheckResult(checkResult.reasonCode);
	}
	return checkResult;
}

async function runAttestationValidation({
	sessionId,
	context,
}: {
	sessionId: string;
	context: VerifySocketContext;
}) {
	if (!isAttestationGateEnabled(context.env)) {
		// Gate is off (pre-rollout). Surface presence/absence in logs but never
		// fail-close. CA-v1-only and no-DG15 attempts continue to skip without
		// an anti-cloning anchor until the flag flips.
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
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
	context.transport.sendCheckResult(checkResult);
	if (!checkResult.retryAllowed) {
		context.transport.closeAfterCheckResult(checkResult.reasonCode);
	}
	return checkResult;
}

export async function runPhaseValidation(
	context: VerifySocketContext,
	sessionId: string,
	nextPhase: "nfc_complete" | "liveness_complete",
) {
	if (nextPhase === "nfc_complete") {
		const { dg1, dg2, dg14, dg15, sod } = context.state.transfer;

		if (!(dg1 && dg2 && sod)) {
			return null;
		}

		const attestCheckResult = await runAttestationValidation({
			sessionId,
			context,
		});
		if (attestCheckResult) {
			return attestCheckResult;
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
					session_id: sessionId,
					crl_status: authenticity.crlStatus,
					dg14_uploaded: dg14 !== undefined,
					dg15_uploaded: dg15 !== undefined,
					passive_auth_detail: authenticity.detail ?? null,
					passive_auth_reason: authenticity.reason,
					revocation_outcome: authenticity.revocationOutcome,
					signer_source: authenticity.signerSource,
				},
				event: "verify.ws.passive_auth_failed",
			});

			const checkResult = await completeCheckWithNegativeSignal({
				code: "document_authenticity_failed",
				context,
				riskScore: 1,
			});
			context.transport.sendCheckResult(checkResult);
			if (!checkResult.retryAllowed) {
				context.transport.closeAfterCheckResult(checkResult.reasonCode);
			}
			return checkResult;
		}

		logEvent(context.log, {
			details: {
				session_id: sessionId,
				crl_status: authenticity.crlStatus,
				dg14_uploaded: dg14 !== undefined,
				dg15_uploaded: dg15 !== undefined,
				passive_auth_algorithm: authenticity.algorithm,
				revocation_outcome: authenticity.revocationOutcome,
				signer_source: authenticity.signerSource,
				sod_declares_dg14: authenticity.sodDeclares.dg14,
				sod_declares_dg15: authenticity.sodDeclares.dg15,
			},
			event: "verify.ws.passive_auth_succeeded",
		});

		const chipAuthCheckResult = await runChipAuthValidation({
			sessionId,
			context,
			sodDeclaresDg14: authenticity.sodDeclares.dg14,
		});

		if (chipAuthCheckResult) {
			return chipAuthCheckResult;
		}

		return await runActiveAuthValidation({
			sessionId,
			context,
			sodDeclaresDg15: authenticity.sodDeclares.dg15,
		});
	}

	const documentPortrait = context.state.transfer.dg2;
	const livenessVideo = context.state.transfer.livenessVideo;
	if (!(documentPortrait && livenessVideo)) {
		return null;
	}

	const thresholdResult = resolveFaceMatchThreshold(context, sessionId);

	if (!thresholdResult.ok) {
		// PA already validated DG1 by hash, so reaching here means the inner
		// MRZ structure is malformed (or, under defence-in-depth, transfer
		// state lost DG1 after the upstream presence check). Use
		// `document_data_invalid` so it doesn't get conflated with a real
		// authenticity rejection; `face_match_threshold_reason` discriminates
		// the variant in telemetry.
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
		return checkResult;
	}

	const threshold = thresholdResult.threshold;

	// Fail fast on missing nonce (e.g. reconnect lost the issue);
	// the container would reject anyway, this keeps the reason precise.
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
		context.transport.sendCheckResult(checkResult);
		if (!checkResult.retryAllowed) {
			context.transport.closeAfterCheckResult(checkResult.reasonCode);
		}
		return checkResult;
	}

	const result = await verifyLiveness({
		dg2Image: documentPortrait,
		video: livenessVideo,
		challengeNonce,
		faceMatchThreshold: threshold,
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
			face_match_threshold: threshold,
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
