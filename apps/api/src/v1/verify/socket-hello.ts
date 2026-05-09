import { logEvent } from "@kayle-id/config/logging";
import {
	claimAttemptConnection,
	releaseAttemptConnection,
} from "./attempt-connection";
import {
	isAttestationGateEnabled,
	verifyHelloAttestation,
} from "./attest-gate";
import {
	consumeHelloAttempt,
	getAttemptForHello,
	type HelloPayload,
	isAttemptMissingOrTerminal,
	markSessionInProgress,
	type ParsedHelloPayload,
	parseHelloPayload,
	resolveHelloAuthState,
} from "./hello-auth";
import { persistTrackedAttemptPhase } from "./phase-state";
import type { VerifySocketContext } from "./socket-context";
import { deriveActiveAuthChallenge } from "./validation";

// Minimum required app version. When set, hellos reporting an older
// `appVersion` are rejected with `MIN_APP_VERSION_REQUIRED` *before* any
// attestation lookup so the user gets a clean "update required" message
// instead of a confusing attestation error.
const MIN_APP_VERSION = process.env.MIN_APP_VERSION ?? "";

async function resetAttemptState(
	context: VerifySocketContext,
	attemptId: string,
): Promise<void> {
	const { connectionOwnerId, state } = context;

	await releaseAttemptConnection({
		attemptId,
		ownerId: connectionOwnerId,
	});
	state.acceptedFaceScore = null;
	state.attemptId = null;
	state.currentPhase = null;
	state.shareManifest = null;
	state.shareRequestSent = false;
}

async function persistConnectedPhaseIfMissing(
	context: VerifySocketContext,
	attemptId: string,
): Promise<void> {
	if (context.state.currentPhase) {
		return;
	}

	await persistTrackedAttemptPhase({
		attemptId,
		phase: "mobile_connected",
	});
	context.state.currentPhase = "mobile_connected";
}

export async function handleHelloMessage(
	context: VerifySocketContext,
	payload: HelloPayload,
): Promise<void> {
	const { connectionOwnerId, log, session, state, transport } = context;
	const parsed = parseHelloPayload(payload);

	transport.logDebug("recv_hello", {
		attemptIdPresent: Boolean(parsed?.attemptId),
		mobileWriteTokenPresent: Boolean(parsed?.mobileWriteToken),
		deviceIdPresent: Boolean(parsed?.deviceId),
	});

	if (!parsed) {
		transport.sendAuthErrorAndClose("HELLO_AUTH_REQUIRED");
		return;
	}

	const attempt = await getAttemptForHello(session.id, parsed.attemptId);
	if (isAttemptMissingOrTerminal(attempt)) {
		transport.sendAuthErrorAndClose("ATTEMPT_NOT_FOUND");
		return;
	}

	if (
		state.helloReceived &&
		state.attemptId &&
		state.attemptId !== attempt.id
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

	const authState = await resolveHelloAuthState({
		attempt,
		mobileWriteToken: parsed.mobileWriteToken,
		deviceId: parsed.deviceId,
		nowMs: Date.now(),
	});

	if (authState.kind === "error") {
		transport.sendAuthErrorAndClose(authState.code);
		return;
	}

	const attestation = await runHelloAttestationGate(context, parsed);
	if (!attestation.ok) {
		transport.sendAuthErrorAndClose(attestation.code);
		return;
	}

	const ownership = await claimAttemptConnection({
		attemptId: attempt.id,
		ownerId: connectionOwnerId,
		// Resume already proved this is the same device via deviceIdHash, so
		// the new socket is allowed to displace whatever owner the previous
		// socket left behind. Otherwise the iOS reconnect that runs right
		// after the NFC scan races the old socket's async release and gets
		// rejected with ATTEMPT_CONNECTION_ACTIVE.
		allowTakeover: authState.kind === "resume",
	});

	if (!ownership.ok) {
		transport.sendAuthErrorAndClose(ownership.code);
		return;
	}

	state.acceptedFaceScore = null;
	state.attemptId = attempt.id;
	state.currentPhase = attempt.currentPhase ?? null;
	state.helloReceived = true;
	state.shareManifest = null;
	state.shareRequestSent = false;
	log.set({
		attempt_id: attempt.id,
	});

	if (parsed.runtimeIntegritySignal !== 0) {
		logEvent(log, {
			details: {
				attempt_id: attempt.id,
				runtime_integrity_signal: parsed.runtimeIntegritySignal,
			},
			event: "verify.ws.runtime_integrity_signal",
			level: "warn",
		});
	}

	if (authState.kind === "resume") {
		await persistConnectedPhaseIfMissing(context, attempt.id);
		transport.sendAck("hello_ok");
		await sendActiveAuthChallenge(context, attempt.id);
		return;
	}

	try {
		if (!(await markSessionInProgress(session))) {
			transport.sendAuthErrorAndClose("SESSION_EXPIRED");
			return;
		}
		await consumeHelloAttempt({
			attemptId: attempt.id,
			deviceIdHash: authState.deviceIdHash,
			appVersion: parsed.appVersion,
			mobileAttestKeyId: attestation.attestKeyId,
		});
		await persistTrackedAttemptPhase({
			attemptId: attempt.id,
			phase: "mobile_connected",
		});
		state.currentPhase = "mobile_connected";
	} catch (error) {
		await resetAttemptState(context, attempt.id);
		throw error;
	}

	transport.sendAck("hello_ok");
	await sendActiveAuthChallenge(context, attempt.id);
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
				attempt_id: parsed.attemptId,
				reason: "assertion_missing",
			},
			event: "verify.ws.hello_attest_missing",
			level: "warn",
		});
		return { ok: false, code: "HELLO_ATTEST_KEY_UNKNOWN" };
	}

	const result = await verifyHelloAttestation({
		appVersion: parsed.appVersion,
		attemptId: parsed.attemptId,
		attestKeyId: parsed.attestKeyId,
		authSecret: context.env.AUTH_SECRET as string,
		deviceId: parsed.deviceId,
		helloAssertion: parsed.helloAssertion,
	});

	if (!result.ok) {
		logEvent(context.log, {
			details: {
				attempt_id: parsed.attemptId,
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
	attemptId: string,
): Promise<void> {
	const challenge = await deriveActiveAuthChallenge({
		attemptId,
		authSecret: context.env.AUTH_SECRET as string,
	});
	context.transport.sendActiveAuthChallenge(challenge);
}
