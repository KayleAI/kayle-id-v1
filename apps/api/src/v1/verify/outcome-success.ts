import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_consents,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, eq, inArray } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { createWebhookDeliveriesForVerificationSessionSucceeded } from "@/v1/webhooks/deliveries/service";
import { normalizeRiskScore } from "./outcome-risk";
import type { SessionContext } from "./outcome-types";
import { ACTIVE_SESSION_STATUSES } from "./status";

type SuccessScoreInput =
	| {
			faceScore: number;
			riskScore?: never;
	  }
	| {
			faceScore?: never;
			riskScore: number;
	  };

function resolveSuccessRiskScore(scoreInput: SuccessScoreInput): number {
	return typeof scoreInput.riskScore === "number"
		? normalizeRiskScore(scoreInput.riskScore)
		: normalizeRiskScore(1 - normalizeRiskScore(scoreInput.faceScore));
}

export async function markSessionSucceeded({
	session,
	selectedFieldKeys = [],
	...scoreInput
}: {
	session: SessionContext;
	selectedFieldKeys?: string[];
} & SuccessScoreInput): Promise<
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
	const riskScore = resolveSuccessRiskScore(scoreInput);

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
