import { logEvent } from "@kayle-id/config/logging";
import type { VerifySocketContext } from "./socket-context";

export function logHelloTiming({
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
