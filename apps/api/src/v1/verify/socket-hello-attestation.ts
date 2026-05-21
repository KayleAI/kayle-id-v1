import { logEvent } from "@kayle-id/config/logging";
import {
	isAttestationGateEnabled,
	verifyHelloAttestation,
} from "./attest-gate";
import type { ParsedHelloPayload } from "./hello-auth";
import type { VerifySocketContext } from "./socket-context";

type HelloAttestationOutcome =
	| { ok: true; attestKeyId: string | null }
	| {
			ok: false;
			code: "HELLO_ATTEST_INVALID" | "HELLO_ATTEST_KEY_UNKNOWN";
	  };

export async function runHelloAttestationGate(
	context: VerifySocketContext,
	parsed: ParsedHelloPayload,
): Promise<HelloAttestationOutcome> {
	const gateOn = isAttestationGateEnabled(context.env);
	const hasAssertion =
		Boolean(parsed.attestKeyId) && parsed.helloAssertion.length > 0;

	if (!gateOn) {
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
