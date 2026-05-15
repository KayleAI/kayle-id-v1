import { db } from "@kayle-id/database/drizzle";
import { verification_attempts } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";

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

export type TrackedAttemptPhase = (typeof PHASE_SEQUENCE)[number];

const PHASE_INDEX: Record<TrackedAttemptPhase, number> = {
	mobile_connected: 0,
	mrz_scanning: 1,
	mrz_complete: 2,
	nfc_reading: 3,
	nfc_complete: 4,
	liveness_capturing: 5,
	liveness_complete: 6,
};

export function isTrackedAttemptPhase(
	phase: string,
): phase is TrackedAttemptPhase {
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
	reference: TrackedAttemptPhase,
): boolean {
	if (!(candidate && isTrackedAttemptPhase(candidate))) {
		return false;
	}
	return PHASE_INDEX[candidate] >= PHASE_INDEX[reference];
}

export type PhaseValidationResult =
	| {
			ok: true;
			nextPhase: TrackedAttemptPhase;
			changed: boolean;
	  }
	| {
			ok: false;
			code: typeof PHASE_OUT_OF_ORDER_CODE;
	  };

export function validateTrackedPhaseTransition({
	currentPhase,
	nextPhase,
}: {
	currentPhase: string | null;
	nextPhase: string;
}): PhaseValidationResult {
	if (!isTrackedAttemptPhase(nextPhase)) {
		return {
			ok: false,
			code: PHASE_OUT_OF_ORDER_CODE,
		};
	}

	if (!currentPhase) {
		if (nextPhase !== "mobile_connected") {
			return {
				ok: false,
				code: PHASE_OUT_OF_ORDER_CODE,
			};
		}

		return {
			ok: true,
			nextPhase,
			changed: true,
		};
	}

	if (!isTrackedAttemptPhase(currentPhase)) {
		return {
			ok: false,
			code: PHASE_OUT_OF_ORDER_CODE,
		};
	}

	if (currentPhase === nextPhase) {
		return {
			ok: true,
			nextPhase,
			changed: false,
		};
	}

	const currentIndex = PHASE_INDEX[currentPhase];
	const nextIndex = PHASE_INDEX[nextPhase];

	if (nextIndex !== currentIndex + 1) {
		return {
			ok: false,
			code: PHASE_OUT_OF_ORDER_CODE,
		};
	}

	return {
		ok: true,
		nextPhase,
		changed: true,
	};
}

export async function persistTrackedAttemptPhase({
	attemptId,
	phase,
}: {
	attemptId: string;
	phase: TrackedAttemptPhase;
}): Promise<void> {
	await db
		.update(verification_attempts)
		.set({
			currentPhase: phase,
			phaseUpdatedAt: new Date(),
		})
		.where(eq(verification_attempts.id, attemptId));
}
