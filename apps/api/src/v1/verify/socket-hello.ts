import { logEvent } from "@kayle-id/config/logging";
import {
	isAttestationGateEnabled,
	verifyHelloAttestation,
} from "./attest-gate";
import {
	consumeHelloHandoff,
	getSessionForHello,
	type HelloPayload,
	isSessionMissingOrTerminal,
	type ParsedHelloPayload,
	parseHelloPayload,
	persistFirstHelloState,
	resolveHelloAuthState,
} from "./hello-auth";
import { persistTrackedSessionPhase } from "./phase-state";
import {
	claimSessionConnection,
	releaseSessionConnection,
} from "./session-connection";
import type { VerifySocketContext } from "./socket-context";
import { deriveActiveAuthChallenge } from "./validation";

// Minimum required app version. When set, hellos reporting an older
// `appVersion` are rejected with `MIN_APP_VERSION_REQUIRED` *before* any
// attestation lookup so the user gets a clean "update required" message
// instead of a confusing attestation error.
const MIN_APP_VERSION = process.env.MIN_APP_VERSION ?? "";

async function resetSessionState(
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

async function persistConnectedPhaseIfMissing(
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
		// `persistFirstHelloState` already writes the consumed-at timestamp and
		// mobileHelloDeviceIdHash; this helper is kept as a safety net for any
		// future caller that wants to update consumption state outside of the
		// first-hello critical section.
		void consumeHelloHandoff;
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

function logHelloTiming({
	sessionId,
	authDurationMs,
	attestationDurationMs,
	helloStartedAt,
	log,
	ownershipDurationMs,
	persistDurationMs,
	resume,
}: {
	sessionId: string;
	authDurationMs: number;
	attestationDurationMs: number;
	helloStartedAt: number;
	log: VerifySocketContext["log"];
	ownershipDurationMs: number;
	persistDurationMs: number;
	resume: boolean;
}): void {
	logEvent(log, {
		details: {
			session_id: sessionId,
			attestation_ms: attestationDurationMs,
			auth_ms: authDurationMs,
			ownership_ms: ownershipDurationMs,
			persist_ms: persistDurationMs,
			resume,
			total_ms: Date.now() - helloStartedAt,
		},
		event: "verify.ws.hello_timing",
	});
}

type HelloAttestationOutcome =
	| { ok: true; attestKeyId: string | null }
	| {
			ok: false;
			code: "HELLO_ATTEST_INVALID" | "HELLO_ATTEST_KEY_UNKNOWN";
	  };

async function runHelloAttestationGate(
	context: VerifySocketContext,
	parsed: ParsedHelloPayload,
): Promise<HelloAttestationOutcome> {
	const gateOn = isAttestationGateEnabled(context.env);
	const hasAssertion =
		Boolean(parsed.attestKeyId) && parsed.helloAssertion.length > 0;

	if (!gateOn) {
		// Pre-rollout: record the keyId for analytics/observability but do not
		// reject pre-update clients. The gate flips to fail-closed once
		// adoption clears the threshold (see plan rollout section).
		return { ok: true, attestKeyId: hasAssertion ? parsed.attestKeyId : null };
	}

	if (!hasAssertion) {
		logEvent(context.log, {
			details: {
				session_id: parsed.sessionId,
				reason: "assertion_missing",
			},
			event: "verify.ws.hello_attest_missing",
			level: "warn",
		});
		return { ok: false, code: "HELLO_ATTEST_KEY_UNKNOWN" };
	}

	const result = await verifyHelloAttestation({
		appVersion: parsed.appVersion,
		sessionId: parsed.sessionId,
		attestKeyId: parsed.attestKeyId,
		authSecret: context.env.AUTH_SECRET as string,
		deviceId: parsed.deviceId,
		helloAssertion: parsed.helloAssertion,
	});

	if (!result.ok) {
		logEvent(context.log, {
			details: {
				session_id: parsed.sessionId,
				attest_key_id: parsed.attestKeyId,
				reason: result.code,
				detail: result.detail ?? null,
			},
			event: "verify.ws.hello_attest_failed",
			level: "warn",
		});
		return {
			ok: false,
			code:
				result.code === "HELLO_ATTEST_KEY_UNKNOWN"
					? "HELLO_ATTEST_KEY_UNKNOWN"
					: "HELLO_ATTEST_INVALID",
		};
	}

	return { ok: true, attestKeyId: parsed.attestKeyId };
}

function isAppVersionAtLeast(actual: string, minimum: string): boolean {
	if (!(actual && minimum)) {
		return true;
	}
	const a = parseSemver(actual);
	const m = parseSemver(minimum);
	if (!(a && m)) {
		return true;
	}
	for (let i = 0; i < 3; i += 1) {
		if ((a[i] ?? 0) > (m[i] ?? 0)) return true;
		if ((a[i] ?? 0) < (m[i] ?? 0)) return false;
	}
	return true;
}

function parseSemver(value: string): [number, number, number] | null {
	const parts = value.split(".").map((part) => Number.parseInt(part, 10));
	if (parts.some((p) => Number.isNaN(p))) {
		return null;
	}
	return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

async function sendActiveAuthChallenge(
	context: VerifySocketContext,
	sessionId: string,
): Promise<void> {
	const challenge = await deriveActiveAuthChallenge({
		sessionId,
		authSecret: context.env.AUTH_SECRET as string,
	});
	context.transport.sendActiveAuthChallenge(challenge);
}
