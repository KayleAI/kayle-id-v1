import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createWebhookDeliveriesForVerificationSessionFailed } from "@/v1/webhooks/deliveries/service";
import { SessionTransitionSkippedError } from "./outcome-error";
import { createSessionFailedEvent } from "./outcome-events";
import { normalizeRiskScore } from "./outcome-risk";
import type { SessionContext } from "./outcome-types";
import type { NegativeFailureCode } from "./retry-limits";
import { ACTIVE_SESSION_STATUSES } from "./status";

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

			const sessionFailedEventId = await createSessionFailedEvent(tx, {
				session,
				failureCode,
				nfcTriesUsed: terminated.nfcTriesUsed,
				livenessTriesUsed: terminated.livenessTriesUsed,
			});

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
