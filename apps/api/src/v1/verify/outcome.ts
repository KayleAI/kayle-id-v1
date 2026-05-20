import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_consents,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import {
	createWebhookDeliveriesForVerificationSessionFailed,
	createWebhookDeliveriesForVerificationSessionSucceeded,
} from "@/v1/webhooks/deliveries/service";
import {
	type CheckKind,
	failedCheckForCode,
	isHardKillCode,
	MAX_LIVENESS_RETRIES,
	MAX_NFC_RETRIES,
	type NegativeFailureCode,
} from "./retry-limits";
import { ACTIVE_SESSION_STATUSES } from "./status";

export type { CheckKind, NegativeFailureCode } from "./retry-limits";
export {
	failedCheckForCode,
	isHardKillCode,
	MAX_LIVENESS_RETRIES,
	MAX_NFC_RETRIES,
} from "./retry-limits";

class SessionTransitionSkippedError extends Error {
	constructor() {
		super("verification_session_not_active");
		this.name = "SessionTransitionSkippedError";
	}
}

type SessionContext = {
	contractVersion: number;
	id: string;
	organizationId: string;
	status: string;
	completedAt: Date | null;
};

function normalizeRiskScore(score: number): number {
	if (Number.isNaN(score)) {
		return 0;
	}

	return Math.max(0, Math.min(1, score));
}

export type MarkCheckFailedResult = {
	terminalized: boolean;
	deliveryIds: string[];
	nfcTriesUsed: number;
	livenessTriesUsed: number;
	remainingNfcRetries: number;
	remainingLivenessRetries: number;
};

/**
 * Record a check failure. NFC and liveness failures increment a per-check
 * counter and rewind the phase so the user can retry inside the same session.
 * MRZ failures (`document_data_invalid`) and hard-kill codes never increment;
 * MRZ is unlimited, hard-kill terminates immediately via `markSessionFailed`.
 */
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
			remainingNfcRetries: Math.max(
				0,
				MAX_NFC_RETRIES - terminalResult.nfcTriesUsed,
			),
			remainingLivenessRetries: Math.max(
				0,
				MAX_LIVENESS_RETRIES - terminalResult.livenessTriesUsed,
			),
		};
	}

	const check: CheckKind = failedCheckForCode(failureCode);

	if (check === "mrz") {
		// MRZ failures are unlimited and purely a phase rewind; no counter,
		// no audit log, no webhook.
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
			remainingNfcRetries: Math.max(0, MAX_NFC_RETRIES - nfcTriesUsed),
			remainingLivenessRetries: Math.max(
				0,
				MAX_LIVENESS_RETRIES - livenessTriesUsed,
			),
		};
	}

	const now = new Date();
	const checkColumn =
		check === "nfc"
			? verification_sessions.nfcTriesUsed
			: verification_sessions.livenessTriesUsed;
	const checkColumnName =
		check === "nfc" ? "nfc_tries_used" : "liveness_tries_used";
	const rewindPhase = check === "nfc" ? "nfc_reading" : "liveness_capturing";
	const maxRetries = check === "nfc" ? MAX_NFC_RETRIES : MAX_LIVENESS_RETRIES;

	type IncrementResult = {
		nfcTriesUsed: number;
		livenessTriesUsed: number;
		terminalized: boolean;
	};

	let txResult: IncrementResult & { sessionFailedEventId: string | null };
	try {
		txResult = await db.transaction(async (tx) => {
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

			await recordAuditLog(
				{
					actorType: "system",
					organizationId: session.organizationId,
					event: "session.check.failed",
					targetId: session.id,
					targetType: "verification_session",
					metadata: { failure_code: failureCode, failed_check: check },
				},
				tx,
			);

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

			// Per-check budget exhausted → session-level failure.
			const sessionFailedEventId = generateId({ type: "evt" });
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

			await tx.insert(events).values({
				id: sessionFailedEventId,
				organizationId: session.organizationId,
				type: "verification.session.failed",
				triggerId: session.id,
				triggerType: "verification_session",
			});

			await recordAuditLog(
				{
					actorType: "system",
					organizationId: session.organizationId,
					event: "session.failed",
					targetId: session.id,
					targetType: "verification_session",
					metadata: {
						failure_code: failureCode,
						failed_check: check,
						nfc_tries_used: incremented.nfcTriesUsed,
						liveness_tries_used: incremented.livenessTriesUsed,
					},
				},
				tx,
			);

			session.status = terminated.status;
			session.completedAt = terminated.completedAt;

			return {
				nfcTriesUsed: incremented.nfcTriesUsed,
				livenessTriesUsed: incremented.livenessTriesUsed,
				terminalized: true,
				sessionFailedEventId,
			};
		});
	} catch (error) {
		if (error instanceof SessionTransitionSkippedError) {
			return {
				terminalized: true,
				deliveryIds: [],
				nfcTriesUsed: maxRetries,
				livenessTriesUsed: maxRetries,
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
		remainingNfcRetries: Math.max(0, MAX_NFC_RETRIES - txResult.nfcTriesUsed),
		remainingLivenessRetries: Math.max(
			0,
			MAX_LIVENESS_RETRIES - txResult.livenessTriesUsed,
		),
	};
}

/**
 * Terminalize a session with a failure status. Used by hard-kill paths
 * (attestation failure) and by callers that want to fail the session without
 * crediting a per-check retry.
 */
export async function markSessionFailed({
	session,
	failureCode,
	riskScore,
}: {
	session: SessionContext;
	failureCode: NegativeFailureCode;
	riskScore: number;
}): Promise<{
	deliveryIds: string[];
	nfcTriesUsed: number;
	livenessTriesUsed: number;
}> {
	const now = new Date();

	let txResult: {
		sessionFailedEventId: string;
		nfcTriesUsed: number;
		livenessTriesUsed: number;
	};
	try {
		txResult = await db.transaction(async (tx) => {
			const [terminated] = await tx
				.update(verification_sessions)
				.set({
					status: "failed",
					failureCode,
					riskScore: sql`greatest(${verification_sessions.riskScore}, ${normalizeRiskScore(riskScore)})`,
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
					nfcTriesUsed: verification_sessions.nfcTriesUsed,
					livenessTriesUsed: verification_sessions.livenessTriesUsed,
				});

			if (!terminated) {
				throw new SessionTransitionSkippedError();
			}

			const sessionFailedEventId = generateId({ type: "evt" });
			await tx.insert(events).values({
				id: sessionFailedEventId,
				organizationId: session.organizationId,
				type: "verification.session.failed",
				triggerId: session.id,
				triggerType: "verification_session",
			});

			await recordAuditLog(
				{
					actorType: "system",
					organizationId: session.organizationId,
					event: "session.failed",
					targetId: session.id,
					targetType: "verification_session",
					metadata: {
						failure_code: failureCode,
						nfc_tries_used: terminated.nfcTriesUsed,
						liveness_tries_used: terminated.livenessTriesUsed,
					},
				},
				tx,
			);

			session.status = terminated.status;
			session.completedAt = terminated.completedAt;

			return {
				sessionFailedEventId,
				nfcTriesUsed: terminated.nfcTriesUsed,
				livenessTriesUsed: terminated.livenessTriesUsed,
			};
		});
	} catch (error) {
		if (error instanceof SessionTransitionSkippedError) {
			return { deliveryIds: [], nfcTriesUsed: 0, livenessTriesUsed: 0 };
		}
		throw error;
	}

	const deliveryIds = await createWebhookDeliveriesForVerificationSessionFailed(
		{
			contractVersion: session.contractVersion,
			eventId: txResult.sessionFailedEventId,
			failureCode,
			nfcTriesUsed: txResult.nfcTriesUsed,
			livenessTriesUsed: txResult.livenessTriesUsed,
			organizationId: session.organizationId,
			sessionId: session.id,
		},
	);

	return {
		deliveryIds,
		nfcTriesUsed: txResult.nfcTriesUsed,
		livenessTriesUsed: txResult.livenessTriesUsed,
	};
}

export async function markSessionSucceeded({
	session,
	selectedFieldKeys = [],
	...scoreInput
}: {
	session: SessionContext;
	selectedFieldKeys?: string[];
} & (
	| {
			faceScore: number;
			riskScore?: never;
	  }
	| {
			faceScore?: never;
			riskScore: number;
	  }
)): Promise<
	| {
			sessionSucceededEventId: string;
			deliveryIds: string[];
	  }
	| {
			sessionSucceededEventId: null;
			deliveryIds: string[];
	  }
> {
	const now = new Date();
	const riskScore =
		typeof scoreInput.riskScore === "number"
			? normalizeRiskScore(scoreInput.riskScore)
			: normalizeRiskScore(1 - normalizeRiskScore(scoreInput.faceScore));

	const result = await db.transaction(async (tx) => {
		const [completedSession] = await tx
			.update(verification_sessions)
			.set({
				status: "succeeded",
				failureCode: null,
				riskScore,
				selectedShareFieldKeys: selectedFieldKeys,
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

		if (!completedSession) {
			return { sessionSucceededEventId: null };
		}

		await tx
			.update(verification_consents)
			.set({ selectedClaimKeys: selectedFieldKeys })
			.where(eq(verification_consents.verificationSessionId, session.id));

		const sessionSucceededEventId = generateId({ type: "evt" });

		await tx.insert(events).values({
			id: sessionSucceededEventId,
			organizationId: session.organizationId,
			type: "verification.session.succeeded",
			triggerId: session.id,
			triggerType: "verification_session",
		});

		await recordAuditLog(
			{
				actorType: "system",
				organizationId: session.organizationId,
				event: "session.succeeded",
				targetId: session.id,
				targetType: "verification_session",
				metadata: {},
			},
			tx,
		);

		return { sessionSucceededEventId };
	});

	if (!result.sessionSucceededEventId) {
		return { sessionSucceededEventId: null, deliveryIds: [] };
	}

	session.status = "succeeded";
	session.completedAt = now;

	const deliveryIds =
		await createWebhookDeliveriesForVerificationSessionSucceeded({
			contractVersion: session.contractVersion,
			eventId: result.sessionSucceededEventId,
			organizationId: session.organizationId,
			sessionId: session.id,
		});

	return {
		sessionSucceededEventId: result.sessionSucceededEventId,
		deliveryIds,
	};
}
