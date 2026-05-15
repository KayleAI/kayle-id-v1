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

	const verdict =
		nextPhase === "nfc_complete" || nextPhase === "liveness_complete"
			? await runPhaseValidation(context, state.attemptId, nextPhase)
			: null;

	if (
		verdict?.outcome === "rejected" ||
		(nextPhase === "nfc_complete" && verdict)
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
			if (typeof authSecret === "string" && authSecret.length > 0) {
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
	}

	if (nextPhase === "liveness_complete" && verdict) {
		transport.sendVerdict(verdict);
		transport.sendShareRequest(context.shareRequestPayload);
		state.shareRequestSent = true;
		return;
	}

	transport.sendAck("phase_ok");
}
