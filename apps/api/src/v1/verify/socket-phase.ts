import { logEvent } from "@kayle-id/config/logging";
import { prewarmBiometricVerifier } from "./biometric-verifier-client";
import { resolveVerifyErrorMessage } from "./error-response";
import { deriveLivenessChallenge } from "./liveness-challenge";
import {
	isTrackedAttemptPhase,
	persistTrackedAttemptPhase,
	validateTrackedPhaseTransition,
} from "./phase-state";
import type { VerifySocketContext } from "./socket-context";
import {
	buildMissingDataMessage,
	runPhaseValidation,
} from "./socket-phase-validation";

type PhasePayload = {
	error?: string;
	phase?: string;
	attestAssertion?: Uint8Array;
};

export async function handlePhaseMessage(
	context: VerifySocketContext,
	payload: PhasePayload,
): Promise<void> {
	const { state, transport } = context;

	transport.logDebug("recv_phase", {
		phase: payload.phase ?? "",
		error: payload.error ?? "",
	});

	if (!state.attemptId) {
		transport.sendError("HELLO_REQUIRED", "Send hello before other messages.");
		return;
	}

	const nextPhase = payload.phase?.trim() ?? "";
	if (!isTrackedAttemptPhase(nextPhase)) {
		transport.sendAck("phase_ok");
		return;
	}

	if (
		nextPhase === "nfc_complete" &&
		payload.attestAssertion &&
		payload.attestAssertion.length > 0
	) {
		state.transfer.nfcAttestAssertion = payload.attestAssertion;
	}

	const missingData = buildMissingDataMessage(context, nextPhase);
	if (missingData) {
		transport.sendError(missingData.code, missingData.message);
		return;
	}

	const transition = validateTrackedPhaseTransition({
		currentPhase: state.currentPhase,
		nextPhase,
	});
	if (!transition.ok) {
		transport.sendError(
			transition.code,
			resolveVerifyErrorMessage(transition.code),
		);
		return;
	}

	const checkResult =
		nextPhase === "nfc_complete" || nextPhase === "liveness_complete"
			? await runPhaseValidation(context, state.attemptId, nextPhase)
			: null;

	if (
		checkResult?.outcome === "not_confirmed" ||
		(nextPhase === "nfc_complete" && checkResult)
	) {
		return;
	}

	if (transition.changed) {
		await persistTrackedAttemptPhase({
			attemptId: state.attemptId,
			phase: transition.nextPhase,
		});
		state.currentPhase = transition.nextPhase;

		// User just entered liveness capture — they have ~10-15s of
		// recording + upload runway. Prewarm the verifier container so
		// its cold-start runs in parallel with capture instead of
		// blocking the eventual /verify call, and issue the per-attempt
		// challenge nonce the client will echo inside the recording.
		if (transition.nextPhase === "liveness_capturing") {
			context.scheduleTask(
				prewarmBiometricVerifier({
					env: context.env,
					attemptId: state.attemptId,
				}),
			);
			const authSecret = context.env.AUTH_SECRET;
			if (!(typeof authSecret === "string" && authSecret.length > 0)) {
				// Without AUTH_SECRET we can't derive the per-attempt
				// challenge, and the verifier rejects clips without a
				// matching nonce. Fail loudly here rather than letting the
				// iOS engine hang on a never-arriving challenge.
				logEvent(context.log, {
					details: { attempt_id: state.attemptId },
					event: "verify.ws.liveness_challenge_unavailable",
					level: "warn",
				});
				transport.sendError(
					"LIVENESS_CHALLENGE_UNAVAILABLE",
					resolveVerifyErrorMessage("LIVENESS_CHALLENGE_UNAVAILABLE"),
				);
				transport.closeAfterCheckResult("LIVENESS_CHALLENGE_UNAVAILABLE");
				return;
			}
			const challenge = await deriveLivenessChallenge({
				attemptId: state.attemptId,
				authSecret,
			});
			state.livenessChallengeNonce = challenge.challengeNonce;
			transport.sendLivenessChallenge({
				maxDurationMs: challenge.maxDurationMs,
				challengeNonce: challenge.challengeNonce,
			});
		}
	}

	if (nextPhase === "liveness_complete" && checkResult) {
		transport.sendCheckResult(checkResult);
		transport.sendShareRequest(context.shareRequestPayload);
		state.shareRequestSent = true;
		return;
	}

	transport.sendAck("phase_ok");
}
