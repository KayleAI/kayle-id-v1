import type { VerifyShareManifest } from "@/v1/verify/share-manifest";
import type {
	VerificationAttemptFailedCode,
	VerificationAttemptFailedPayload,
	VerificationSessionCancelledPayload,
	VerificationSessionExpiredPayload,
	VerificationSucceededPayload,
} from "./types";

export function buildVerificationSucceededPayload({
	attemptId,
	eventId,
	manifest,
}: {
	attemptId: string;
	eventId: string;
	manifest: VerifyShareManifest;
}): VerificationSucceededPayload {
	return {
		data: {
			claims: manifest.claims,
			selected_field_keys: manifest.selectedFieldKeys,
		},
		metadata: {
			contract_version: manifest.contractVersion,
			event_id: eventId,
			verification_attempt_id: attemptId,
			verification_session_id: manifest.sessionId,
		},
		type: "verification.attempt.succeeded",
	};
}

export function buildVerificationAttemptFailedPayload({
	attemptId,
	contractVersion,
	eventId,
	failureCode,
	sessionId,
}: {
	attemptId: string;
	contractVersion: number;
	eventId: string;
	failureCode: VerificationAttemptFailedCode;
	sessionId: string;
}): VerificationAttemptFailedPayload {
	return {
		data: {
			failure_code: failureCode,
		},
		metadata: {
			contract_version: contractVersion,
			event_id: eventId,
			verification_attempt_id: attemptId,
			verification_session_id: sessionId,
		},
		type: "verification.attempt.failed",
	};
}

export function buildVerificationSessionExpiredPayload({
	contractVersion,
	eventId,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	sessionId: string;
}): VerificationSessionExpiredPayload {
	return {
		data: {},
		metadata: {
			contract_version: contractVersion,
			event_id: eventId,
			verification_session_id: sessionId,
		},
		type: "verification.session.expired",
	};
}

export function buildVerificationSessionCancelledPayload({
	contractVersion,
	eventId,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	sessionId: string;
}): VerificationSessionCancelledPayload {
	return {
		data: {},
		metadata: {
			contract_version: contractVersion,
			event_id: eventId,
			verification_session_id: sessionId,
		},
		type: "verification.session.cancelled",
	};
}
