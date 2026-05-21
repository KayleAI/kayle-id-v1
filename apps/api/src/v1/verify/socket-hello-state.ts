import { persistTrackedSessionPhase } from "./phase-state";
import { releaseSessionConnection } from "./session-connection";
import type { VerifySocketContext } from "./socket-context";
import { deriveActiveAuthChallenge } from "./validation";

export async function resetSessionState(
	context: VerifySocketContext,
	sessionId: string,
): Promise<void> {
	const { connectionOwnerId, state } = context;

	await releaseSessionConnection({
		sessionId,
		ownerId: connectionOwnerId,
	});
	state.confirmedFaceScore = null;
	state.sessionId = null;
	state.currentPhase = null;
	state.shareManifest = null;
	state.shareRequestSent = false;
}

export async function persistConnectedPhaseIfMissing(
	context: VerifySocketContext,
	sessionId: string,
): Promise<void> {
	if (context.state.currentPhase) {
		return;
	}

	await persistTrackedSessionPhase({
		sessionId,
		phase: "mobile_connected",
	});
	context.state.currentPhase = "mobile_connected";
}

export async function sendActiveAuthChallenge(
	context: VerifySocketContext,
	sessionId: string,
): Promise<void> {
	const challenge = await deriveActiveAuthChallenge({
		sessionId,
		authSecret: context.env.AUTH_SECRET as string,
	});
	context.transport.sendActiveAuthChallenge(challenge);
}
