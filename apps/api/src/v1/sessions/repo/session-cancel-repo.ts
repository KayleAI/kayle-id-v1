import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { events, verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, inArray } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { ACTIVE_SESSION_STATUSES } from "@/v1/verify/status";
import {
	createWebhookDeliveriesForVerificationSessionCancelled,
	triggerWebhookDeliveryWorkflows,
} from "@/v1/webhooks/deliveries/service";
import { SESSION_PRIVACY_MINIMIZATION_VALUES } from "./session-lifecycle-config";

export async function cancelVerificationSession({
	env,
	row,
	organizationId,
}: {
	env?: CloudflareBindings;
	row: typeof verification_sessions.$inferSelect;
	organizationId: string;
}) {
	const now = new Date();

	const result = await db.transaction(async (tx) => {
		const sessionCancelledEventId = generateId({
			type: "evt",
		});

		const [cancelled] = await tx
			.update(verification_sessions)
			.set({
				...SESSION_PRIVACY_MINIMIZATION_VALUES,
				status: "cancelled",
				completedAt: now,
			})
			.where(
				and(
					eq(verification_sessions.id, row.id),
					eq(verification_sessions.organizationId, organizationId),
					inArray(verification_sessions.status, ACTIVE_SESSION_STATUSES),
				),
			)
			.returning({
				contractVersion: verification_sessions.contractVersion,
				id: verification_sessions.id,
				livenessTriesUsed: verification_sessions.livenessTriesUsed,
				nfcTriesUsed: verification_sessions.nfcTriesUsed,
				organizationId: verification_sessions.organizationId,
			});

		if (!cancelled) {
			return null;
		}

		await tx.insert(events).values({
			id: sessionCancelledEventId,
			organizationId: cancelled.organizationId,
			type: "verification.session.cancelled",
			triggerId: cancelled.id,
			triggerType: "verification_session",
		});

		await recordAuditLog(
			{
				actorType: "system",
				organizationId: cancelled.organizationId,
				event: "session.cancelled",
				targetId: cancelled.id,
				targetType: "verification_session",
			},
			tx,
		);

		return {
			contractVersion: cancelled.contractVersion,
			livenessTriesUsed: cancelled.livenessTriesUsed,
			nfcTriesUsed: cancelled.nfcTriesUsed,
			organizationId: cancelled.organizationId,
			sessionCancelledEventId,
			sessionId: cancelled.id,
		};
	});

	if (!result) {
		return;
	}

	const consumedAnyRetryBudget =
		result.livenessTriesUsed > 0 || result.nfcTriesUsed > 0;

	const deliveryIds =
		await createWebhookDeliveriesForVerificationSessionCancelled({
			contractVersion: result.contractVersion,
			eventId: result.sessionCancelledEventId,
			livenessTriesUsed: result.livenessTriesUsed,
			nfcTriesUsed: result.nfcTriesUsed,
			organizationId: result.organizationId,
			outcome: "not_verified",
			reason: consumedAnyRetryBudget
				? "cancelled_after_failed_check"
				: "cancelled",
			sessionId: result.sessionId,
		});

	await triggerWebhookDeliveryWorkflows({ env, deliveryIds });
}
