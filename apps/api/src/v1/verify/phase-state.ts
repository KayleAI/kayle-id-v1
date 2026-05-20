import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { MAX_LIVENESS_RETRIES, MAX_NFC_RETRIES } from "./retry-limits";

export const PHASE_OUT_OF_ORDER_CODE = "PHASE_OUT_OF_ORDER" as const;

const PHASE_SEQUENCE = [
	"mobile_connected",
	"mrz_scanning",
	"mrz_complete",
	"nfc_reading",
	"nfc_complete",
	"liveness_capturing",
	"liveness_complete",
] as const;

export type TrackedSessionPhase = (typeof PHASE_SEQUENCE)[number];

const PHASE_INDEX: Record<TrackedSessionPhase, number> = {
	mobile_connected: 0,
	mrz_scanning: 1,
	mrz_complete: 2,
	nfc_reading: 3,
	nfc_complete: 4,
	liveness_capturing: 5,
	liveness_complete: 6,
};

export function isTrackedSessionPhase(
	phase: string,
): phase is TrackedSessionPhase {
	return phase in PHASE_INDEX;
}

/**
 * True when the candidate phase has reached or passed the reference phase in
 * the canonical sequence. Used to gate data uploads so a reconnect that lands
 * on a phase past the initial gate (e.g., currentPhase=nfc_complete after the
 * iOS app restored a session) can still re-stream artifacts.
 */
export function isPhaseAtOrAfter(
	candidate: string | null,
	reference: TrackedSessionPhase,
): boolean {
	if (!(candidate && isTrackedSessionPhase(candidate))) {
		return false;
	}
	return PHASE_INDEX[candidate] >= PHASE_INDEX[reference];
}

export type RetryContext = {
	nfcTriesUsed: number;
	livenessTriesUsed: number;
};

export type PhaseValidationResult =
	| {
			ok: true;
			nextPhase: TrackedSessionPhase;
			changed: boolean;
	  }
	| {
			ok: false;
			code: typeof PHASE_OUT_OF_ORDER_CODE;
	  };

/**
 * Allowed phase transitions. Sequential advance is always allowed; per-check
 * rewinds (`nfc_complete → nfc_reading`, `liveness_complete → liveness_capturing`)
 * require the matching counter to be below its budget. MRZ rewind is unlimited.
 */
export function validateTrackedPhaseTransition({
	currentPhase,
	nextPhase,
	retryContext,
}: {
	currentPhase: string | null;
	nextPhase: string;
	retryContext?: RetryContext;
}): PhaseValidationResult {
	if (!isTrackedSessionPhase(nextPhase)) {
		return { ok: false, code: PHASE_OUT_OF_ORDER_CODE };
	}

	if (!currentPhase) {
		if (nextPhase !== "mobile_connected") {
			return { ok: false, code: PHASE_OUT_OF_ORDER_CODE };
		}
		return { ok: true, nextPhase, changed: true };
	}

	if (!isTrackedSessionPhase(currentPhase)) {
		return { ok: false, code: PHASE_OUT_OF_ORDER_CODE };
	}

	if (currentPhase === nextPhase) {
		return { ok: true, nextPhase, changed: false };
	}

	const currentIndex = PHASE_INDEX[currentPhase];
	const nextIndex = PHASE_INDEX[nextPhase];

	// Sequential advance.
	if (nextIndex === currentIndex + 1) {
		return { ok: true, nextPhase, changed: true };
	}

	// Per-check rewinds.
	if (currentPhase === "mrz_complete" && nextPhase === "mrz_scanning") {
		return { ok: true, nextPhase, changed: true };
	}

	if (currentPhase === "nfc_complete" && nextPhase === "nfc_reading") {
		if (retryContext && retryContext.nfcTriesUsed >= MAX_NFC_RETRIES) {
			return { ok: false, code: PHASE_OUT_OF_ORDER_CODE };
		}
		return { ok: true, nextPhase, changed: true };
	}

	if (
		currentPhase === "liveness_complete" &&
		nextPhase === "liveness_capturing"
	) {
		if (
			retryContext &&
			retryContext.livenessTriesUsed >= MAX_LIVENESS_RETRIES
		) {
			return { ok: false, code: PHASE_OUT_OF_ORDER_CODE };
		}
		return { ok: true, nextPhase, changed: true };
	}

	return { ok: false, code: PHASE_OUT_OF_ORDER_CODE };
}

export async function persistTrackedSessionPhase({
	sessionId,
	phase,
}: {
	sessionId: string;
	phase: TrackedSessionPhase;
}): Promise<void> {
	await db
		.update(verification_sessions)
		.set({
			currentPhase: phase,
			phaseUpdatedAt: new Date(),
		})
		.where(eq(verification_sessions.id, sessionId));
}
