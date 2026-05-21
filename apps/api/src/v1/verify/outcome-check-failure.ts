import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createWebhookDeliveriesForVerificationSessionFailed } from "@/v1/webhooks/deliveries/service";
import { SessionTransitionSkippedError } from "./outcome-error";
import {
	createSessionFailedEvent,
	recordCheckFailedAuditLog,
} from "./outcome-events";
import { normalizeRiskScore } from "./outcome-risk";
import { markSessionFailed } from "./outcome-terminal-failure";
import type { SessionContext } from "./outcome-types";
import {
	type CheckKind,
	failedCheckForCode,
	isHardKillCode,
	MAX_LIVENESS_RETRIES,
	MAX_NFC_RETRIES,
	type NegativeFailureCode,
} from "./retry-limits";
import { ACTIVE_SESSION_STATUSES } from "./status";

export type MarkCheckFailedResult = {
	terminalized: boolean;
	deliveryIds: string[];
	nfcTriesUsed: number;
	livenessTriesUsed: number;
	remainingNfcRetries: number;
	remainingLivenessRetries: number;
};

type RetryIncrementResult = {
	nfcTriesUsed: number;
	livenessTriesUsed: number;
	terminalized: boolean;
	sessionFailedEventId: string | null;
};

function remainingRetries({
	nfcTriesUsed,
	livenessTriesUsed,
}: {
	nfcTriesUsed: number;
	livenessTriesUsed: number;
}): {
	remainingNfcRetries: number;
	remainingLivenessRetries: number;
} {
	return {
		remainingNfcRetries: Math.max(0, MAX_NFC_RETRIES - nfcTriesUsed),
		remainingLivenessRetries: Math.max(
			0,
			MAX_LIVENESS_RETRIES - livenessTriesUsed,
		),
	};
}

async function rewindUnlimitedMrzFailure({
	session,
	riskScore,
}: {
	session: SessionContext;
	riskScore: number;
}): Promise<MarkCheckFailedResult> {
	await db
		.update(verification_sessions)
		.set({
			currentPhase: "mrz_scanning",
			phaseUpdatedAt: new Date(),
			riskScore: sql`greatest(${verification_sessions.riskScore}, ${normalizeRiskScore(riskScore)})`,
		})
		.where(eq(verification_sessions.id, session.id));

	const [row] = await db
		.select({
			nfcTriesUsed: verification_sessions.nfcTriesUsed,
			livenessTriesUsed: verification_sessions.livenessTriesUsed,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, session.id));

	const nfcTriesUsed = row?.nfcTriesUsed ?? 0;
	const livenessTriesUsed = row?.livenessTriesUsed ?? 0;
	return {
		terminalized: false,
		deliveryIds: [],
		nfcTriesUsed,
		livenessTriesUsed,
		...remainingRetries({ nfcTriesUsed, livenessTriesUsed }),
	};
}

async function incrementRetryFailure({
	session,
	failureCode,
	riskScore,
	check,
}: {
	session: SessionContext;
	failureCode: NegativeFailureCode;
	riskScore: number;
	check: Exclude<CheckKind, "mrz">;
}): Promise<RetryIncrementResult> {
	const now = new Date();
	const checkColumn =
		check === "nfc"
			? verification_sessions.nfcTriesUsed
			: verification_sessions.livenessTriesUsed;
	const checkColumnName =
		check === "nfc" ? "nfc_tries_used" : "liveness_tries_used";
	const rewindPhase = check === "nfc" ? "nfc_reading" : "liveness_capturing";
	const maxRetries = check === "nfc" ? MAX_NFC_RETRIES : MAX_LIVENESS_RETRIES;

	return db.transaction(async (tx) => {
		const [incremented] = await tx
			.update(verification_sessions)
			.set({
				[checkColumnName]: sql`${checkColumn} + 1`,
				currentPhase: rewindPhase,
				phaseUpdatedAt: now,
				riskScore: sql`greatest(${verification_sessions.riskScore}, ${normalizeRiskScore(riskScore)})`,
			} as Record<string, unknown>)
			.where(
				and(
					eq(verification_sessions.id, session.id),
					eq(verification_sessions.organizationId, session.organizationId),
					inArray(verification_sessions.status, ACTIVE_SESSION_STATUSES),
				),
			)
			.returning({
				nfcTriesUsed: verification_sessions.nfcTriesUsed,
				livenessTriesUsed: verification_sessions.livenessTriesUsed,
			});

		if (!incremented) {
			throw new SessionTransitionSkippedError();
		}

		await recordCheckFailedAuditLog(tx, {
			session,
			failureCode,
			failedCheck: check,
		});

		const checkTriesUsed =
			check === "nfc"
				? incremented.nfcTriesUsed
				: incremented.livenessTriesUsed;
		const exhausted = checkTriesUsed >= maxRetries;

		if (!exhausted) {
			return {
				nfcTriesUsed: incremented.nfcTriesUsed,
				livenessTriesUsed: incremented.livenessTriesUsed,
				terminalized: false,
				sessionFailedEventId: null,
			};
		}

		const [terminated] = await tx
			.update(verification_sessions)
			.set({
				status: "failed",
				failureCode,
				completedAt: now,
			})
			.where(
				and(
					eq(verification_sessions.id, session.id),
					eq(verification_sessions.organizationId, session.organizationId),
					inArray(verification_sessions.status, ACTIVE_SESSION_STATUSES),
				),
			)
			.returning({
				completedAt: verification_sessions.completedAt,
				status: verification_sessions.status,
			});

		if (!terminated) {
			throw new SessionTransitionSkippedError();
		}

		const sessionFailedEventId = await createSessionFailedEvent(tx, {
			session,
			failureCode,
			failedCheck: check,
			nfcTriesUsed: incremented.nfcTriesUsed,
			livenessTriesUsed: incremented.livenessTriesUsed,
		});

		session.status = terminated.status;
		session.completedAt = terminated.completedAt;

		return {
			nfcTriesUsed: incremented.nfcTriesUsed,
			livenessTriesUsed: incremented.livenessTriesUsed,
			terminalized: true,
			sessionFailedEventId,
		};
	});
}

export async function markCheckFailed({
	session,
	failureCode,
	riskScore,
}: {
	session: SessionContext;
	failureCode: NegativeFailureCode;
	riskScore: number;
}): Promise<MarkCheckFailedResult> {
	if (isHardKillCode(failureCode)) {
		const terminalResult = await markSessionFailed({
			session,
			failureCode,
			riskScore,
		});
		return {
			terminalized: true,
			deliveryIds: terminalResult.deliveryIds,
			nfcTriesUsed: terminalResult.nfcTriesUsed,
			livenessTriesUsed: terminalResult.livenessTriesUsed,
			...remainingRetries(terminalResult),
		};
	}

	const check = failedCheckForCode(failureCode);

	if (check === "mrz") {
		return rewindUnlimitedMrzFailure({ session, riskScore });
	}

	let txResult: RetryIncrementResult;
	try {
		txResult = await incrementRetryFailure({
			session,
			failureCode,
			riskScore,
			check,
		});
	} catch (error) {
		if (error instanceof SessionTransitionSkippedError) {
			return {
				terminalized: true,
				deliveryIds: [],
				nfcTriesUsed: MAX_NFC_RETRIES,
				livenessTriesUsed: MAX_LIVENESS_RETRIES,
				remainingNfcRetries: 0,
				remainingLivenessRetries: 0,
			};
		}
		throw error;
	}

	let deliveryIds: string[] = [];
	if (txResult.terminalized && txResult.sessionFailedEventId) {
		deliveryIds = await createWebhookDeliveriesForVerificationSessionFailed({
			contractVersion: session.contractVersion,
			eventId: txResult.sessionFailedEventId,
			failureCode,
			nfcTriesUsed: txResult.nfcTriesUsed,
			livenessTriesUsed: txResult.livenessTriesUsed,
			organizationId: session.organizationId,
			sessionId: session.id,
		});
	}

	return {
		terminalized: txResult.terminalized,
		deliveryIds,
		nfcTriesUsed: txResult.nfcTriesUsed,
		livenessTriesUsed: txResult.livenessTriesUsed,
		...remainingRetries(txResult),
	};
}
