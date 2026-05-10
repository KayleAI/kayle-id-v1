import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, eq, inArray } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { createWebhookDeliveriesForVerificationAttemptFailed } from "@/v1/webhooks/deliveries/service";
import { ACTIVE_SESSION_STATUSES } from "./status";

export const MAX_FAILED_ATTEMPTS = 3;

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

export async function markAttemptFailed({
	session,
	attemptId,
	failureCode,
	riskScore,
}: {
	session: SessionContext;
	attemptId: string;
	failureCode:
		| "document_anti_cloning_attestation_failed"
		| "document_authenticity_failed"
		| "document_active_authentication_failed"
		| "document_chip_authentication_failed"
		| "selfie_face_mismatch";
	riskScore: number;
}): Promise<{
	deliveryIds: string[];
	failedAttempts: number;
	terminalized: boolean;
}> {
	const now = new Date();

	let result: {
		attemptFailedEventId: string;
		failedAttempts: number;
		terminalized: boolean;
	};
	try {
		result = await db.transaction(async (tx) => {
			const attemptFailedEventId = generateId({
				type: "evt",
			});

			await tx
				.update(verification_attempts)
				.set({
					status: "failed",
					failureCode,
					riskScore: normalizeRiskScore(riskScore),
					completedAt: now,
				})
				.where(eq(verification_attempts.id, attemptId));

			await tx.insert(events).values({
				id: attemptFailedEventId,
				organizationId: session.organizationId,
				type: "verification.attempt.failed",
				triggerId: attemptId,
				triggerType: "verification_attempt",
			});

			await recordAuditLog(
				{
					actorType: "system",
					organizationId: session.organizationId,
					event: "session.failed",
					targetId: session.id,
					targetType: "verification_session",
					metadata: { failure_code: failureCode, attempt_id: attemptId },
				},
				tx,
			);

			const failedAttempts = await tx
				.select({
					id: verification_attempts.id,
				})
				.from(verification_attempts)
				.where(
					and(
						eq(verification_attempts.verificationSessionId, session.id),
						eq(verification_attempts.status, "failed"),
					),
				);

			const exhaustedRetryLimit = failedAttempts.length >= MAX_FAILED_ATTEMPTS;

			const [updatedSession] = await tx
				.update(verification_sessions)
				.set({
					status: exhaustedRetryLimit ? "completed" : "created",
					completedAt: exhaustedRetryLimit ? now : null,
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

			const sessionStillActive = Boolean(updatedSession);
			if (!sessionStillActive) {
				throw new SessionTransitionSkippedError();
			}

			if (exhaustedRetryLimit) {
				await tx.insert(events).values({
					id: generateId({ type: "evt" }),
					organizationId: session.organizationId,
					type: "verification.session.completed",
					triggerId: session.id,
					triggerType: "verification_session",
				});
			}

			if (updatedSession) {
				session.status = updatedSession.status;
				session.completedAt = updatedSession.completedAt;
			}

			return {
				attemptFailedEventId,
				failedAttempts: failedAttempts.length,
				terminalized: exhaustedRetryLimit,
			};
		});
	} catch (error) {
		if (error instanceof SessionTransitionSkippedError) {
			return {
				deliveryIds: [],
				failedAttempts: MAX_FAILED_ATTEMPTS,
				terminalized: true,
			};
		}
		throw error;
	}

	const deliveryIds = await createWebhookDeliveriesForVerificationAttemptFailed(
		{
			attemptId,
			contractVersion: session.contractVersion,
			eventId: result.attemptFailedEventId,
			failureCode,
			organizationId: session.organizationId,
			sessionId: session.id,
		},
	);

	return {
		deliveryIds,
		failedAttempts: result.failedAttempts,
		terminalized: result.terminalized,
	};
}

export async function markAttemptSucceeded({
	session,
	attemptId,
	...scoreInput
}: {
	session: SessionContext;
	attemptId: string;
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
			attemptSucceededEventId: string;
			sessionCompletedEventId: string;
	  }
	| {
			attemptSucceededEventId: null;
			sessionCompletedEventId: null;
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
				status: "completed",
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
			return {
				attemptSucceededEventId: null,
				sessionCompletedEventId: null,
			};
		}

		await tx
			.update(verification_attempts)
			.set({
				status: "succeeded",
				failureCode: null,
				riskScore,
				completedAt: now,
			})
			.where(eq(verification_attempts.id, attemptId));

		const attemptSucceededEventId = generateId({
			type: "evt",
		});

		await tx.insert(events).values({
			id: attemptSucceededEventId,
			organizationId: session.organizationId,
			type: "verification.attempt.succeeded",
			triggerId: attemptId,
			triggerType: "verification_attempt",
		});

		const sessionCompletedEventId = generateId({
			type: "evt",
		});

		await tx.insert(events).values({
			id: sessionCompletedEventId,
			organizationId: session.organizationId,
			type: "verification.session.completed",
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
				metadata: { attempt_id: attemptId },
			},
			tx,
		);

		return {
			attemptSucceededEventId,
			sessionCompletedEventId,
		};
	});

	if (result.attemptSucceededEventId) {
		session.status = "completed";
		session.completedAt = now;
	}

	return result;
}
