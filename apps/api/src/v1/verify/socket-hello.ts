import { logEvent } from "@kayle-id/config/logging";
import {
	getSessionForHello,
	type HelloPayload,
	isSessionMissingOrTerminal,
	parseHelloPayload,
	persistFirstHelloState,
	resolveHelloAuthState,
} from "./hello-auth";
import { claimSessionConnection } from "./session-connection";
import type { VerifySocketContext } from "./socket-context";
import { runHelloAttestationGate } from "./socket-hello-attestation";
import {
	persistConnectedPhaseIfMissing,
	resetSessionState,
	sendActiveAuthChallenge,
} from "./socket-hello-state";
import { logHelloTiming } from "./socket-hello-timing";
import { isAppVersionAtLeast, MIN_APP_VERSION } from "./socket-hello-version";

export async function handleHelloMessage(
	context: VerifySocketContext,
	payload: HelloPayload,
): Promise<void> {
	const { connectionOwnerId, log, session, state, transport } = context;
	const helloStartedAt = Date.now();
	const parsed = parseHelloPayload(payload);

	transport.logDebug("recv_hello", {
		sessionIdPresent: Boolean(parsed?.sessionId),
		mobileWriteTokenPresent: Boolean(parsed?.mobileWriteToken),
		deviceIdPresent: Boolean(parsed?.deviceId),
	});

	if (!parsed) {
		transport.sendAuthErrorAndClose("HELLO_AUTH_REQUIRED");
		return;
	}

	if (parsed.sessionId !== session.id) {
		transport.sendAuthErrorAndClose("HELLO_AUTH_REQUIRED");
		return;
	}

	const sessionRow = await getSessionForHello(session.id);
	if (isSessionMissingOrTerminal(sessionRow)) {
		transport.sendAuthErrorAndClose("SESSION_NOT_FOUND");
		return;
	}

	if (
		state.helloReceived &&
		state.sessionId &&
		state.sessionId !== sessionRow.id
	) {
		transport.sendAuthErrorAndClose("HELLO_AUTH_REQUIRED");
		return;
	}

	if (
		MIN_APP_VERSION &&
		!isAppVersionAtLeast(parsed.appVersion, MIN_APP_VERSION)
	) {
		transport.sendAuthErrorAndClose("MIN_APP_VERSION_REQUIRED");
		return;
	}

	const authStartedAt = Date.now();
	const authState = await resolveHelloAuthState({
		session: sessionRow,
		mobileWriteToken: parsed.mobileWriteToken,
		deviceId: parsed.deviceId,
		nowMs: Date.now(),
	});
	const authDurationMs = Date.now() - authStartedAt;

	if (authState.kind === "error") {
		transport.sendAuthErrorAndClose(authState.code);
		return;
	}

	const attestationStartedAt = Date.now();
	const attestation = await runHelloAttestationGate(context, parsed);
	const attestationDurationMs = Date.now() - attestationStartedAt;
	if (!attestation.ok) {
		transport.sendAuthErrorAndClose(attestation.code);
		return;
	}

	const ownershipStartedAt = Date.now();
	const ownership = await claimSessionConnection({
		sessionId: sessionRow.id,
		ownerId: connectionOwnerId,
		// Resume already proved this is the same device via deviceIdHash, so
		// the new socket is allowed to displace whatever owner the previous
		// socket left behind. Otherwise the iOS reconnect that runs right
		// after the NFC scan races the old socket's async release and gets
		// rejected with SESSION_CONNECTION_ACTIVE.
		allowTakeover: authState.kind === "resume",
	});
	const ownershipDurationMs = Date.now() - ownershipStartedAt;

	if (!ownership.ok) {
		transport.sendAuthErrorAndClose(ownership.code);
		return;
	}

	state.confirmedFaceScore = null;
	state.sessionId = sessionRow.id;
	state.currentPhase = sessionRow.currentPhase ?? null;
	state.helloReceived = true;
	state.shareManifest = null;
	state.shareRequestSent = false;
	log.set({
		session_id: sessionRow.id,
	});

	if (parsed.runtimeIntegritySignal !== 0) {
		logEvent(log, {
			details: {
				session_id: sessionRow.id,
				runtime_integrity_signal: parsed.runtimeIntegritySignal,
			},
			event: "verify.ws.runtime_integrity_signal",
			level: "warn",
		});
	}

	if (authState.kind === "resume") {
		const persistStartedAt = Date.now();
		await persistConnectedPhaseIfMissing(context, sessionRow.id);
		const persistDurationMs = Date.now() - persistStartedAt;
		logHelloTiming({
			sessionId: sessionRow.id,
			authDurationMs,
			attestationDurationMs,
			helloStartedAt,
			log,
			ownershipDurationMs,
			persistDurationMs,
			resume: true,
		});
		transport.sendAck("hello_ok");
		await sendActiveAuthChallenge(context, sessionRow.id);
		return;
	}

	try {
		const persistStartedAt = Date.now();
		if (
			!(await persistFirstHelloState({
				deviceIdHash: authState.deviceIdHash,
				appVersion: parsed.appVersion,
				mobileAttestKeyId: attestation.attestKeyId,
				session,
			}))
		) {
			transport.sendAuthErrorAndClose("SESSION_EXPIRED");
			return;
		}

		const persistDurationMs = Date.now() - persistStartedAt;
		state.currentPhase = "mobile_connected";
		logHelloTiming({
			sessionId: sessionRow.id,
			authDurationMs,
			attestationDurationMs,
			helloStartedAt,
			log,
			ownershipDurationMs,
			persistDurationMs,
			resume: false,
		});
	} catch (error) {
		await resetSessionState(context, sessionRow.id);
		throw error;
	}

	transport.sendAck("hello_ok");
	await sendActiveAuthChallenge(context, sessionRow.id);
}
