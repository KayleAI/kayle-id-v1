import type { VerifyShareManifest } from "@/v1/verify/share-manifest";
import type {
	VerificationSessionCancelledOutcome,
	VerificationSessionCancelledPayload,
	VerificationSessionCancelledReason,
	VerificationSessionExpiredPayload,
	VerificationSessionFailedCode,
	VerificationSessionFailedPayload,
	VerificationSessionSucceededPayload,
} from "./types";

export function buildVerificationSessionSucceededPayload({
	eventId,
	manifest,
}: {
	eventId: string;
	manifest: VerifyShareManifest;
}): VerificationSessionSucceededPayload {
	return {
		data: {
			claims: manifest.claims,
			selected_field_keys: manifest.selectedFieldKeys,
		},
		metadata: {
			contract_version: manifest.contractVersion,
			event_id: eventId,
			verification_session_id: manifest.sessionId,
		},
		type: "verification.session.succeeded",
	};
}

export function buildVerificationSessionFailedPayload({
	contractVersion,
	eventId,
	failureCode,
	nfcTriesUsed,
	livenessTriesUsed,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	failureCode: VerificationSessionFailedCode;
	nfcTriesUsed: number;
	livenessTriesUsed: number;
	sessionId: string;
}): VerificationSessionFailedPayload {
	return {
		data: {
			failure_code: failureCode,
			nfc_tries_used: nfcTriesUsed,
			liveness_tries_used: livenessTriesUsed,
		},
		metadata: {
			contract_version: contractVersion,
			event_id: eventId,
			verification_session_id: sessionId,
		},
		type: "verification.session.failed",
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
	livenessTriesUsed,
	nfcTriesUsed,
	outcome,
	reason,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	livenessTriesUsed: number;
	nfcTriesUsed: number;
	outcome: VerificationSessionCancelledOutcome;
	reason: VerificationSessionCancelledReason;
	sessionId: string;
}): VerificationSessionCancelledPayload {
	return {
		data: {
			outcome,
			reason,
			nfc_tries_used: nfcTriesUsed,
			liveness_tries_used: livenessTriesUsed,
		},
		metadata: {
			contract_version: contractVersion,
			event_id: eventId,
			verification_session_id: sessionId,
		},
		type: "verification.session.cancelled",
	};
}
