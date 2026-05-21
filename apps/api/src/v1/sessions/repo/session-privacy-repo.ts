import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { events, verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, inArray } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { ACTIVE_SESSION_STATUSES } from "@/v1/verify/status";
import {
	createWebhookDeliveriesForVerificationSessionCancelled,
	scrubWebhookPayloadsForVerificationSessionPrivacyRequest,
	triggerWebhookDeliveryWorkflows,
} from "@/v1/webhooks/deliveries/service";
import type { VerificationSessionCancelledReason } from "@/v1/webhooks/deliveries/types";
import { cancelVerificationSession } from "./session-cancel-repo";
import { SESSION_PRIVACY_MINIMIZATION_VALUES } from "./session-lifecycle-config";
import type { VerificationSessionPrivacyRequestResult } from "./session-lifecycle-types";

export async function recordVerificationSessionPrivacyRequest({
	env,
	row,
	organizationId,
}: {
	env?: CloudflareBindings;
	row: typeof verification_sessions.$inferSelect;
	organizationId: string;
}): Promise<VerificationSessionPrivacyRequestResult> {
	const scrubResult =
		await scrubWebhookPayloadsForVerificationSessionPrivacyRequest({
			organizationId,
			sessionId: row.id,
		});
	let minimizedCompletedAttemptCount = 0;

	if ((ACTIVE_SESSION_STATUSES as readonly string[]).includes(row.status)) {
		await cancelVerificationSession({ env, organizationId, row });
	} else if (row.status === "succeeded" || row.status === "failed") {
		const now = new Date();
		const shouldMarkWithdrawn = scrubResult.deliveredDeliveryCount === 0;
		const replacementCancelledReason: VerificationSessionCancelledReason =
			row.status === "failed"
				? "privacy_cancelled_after_terminal_failure"
				: "privacy_cancelled_after_terminal_success";
		const txResult = await db.transaction(async (tx) => {
			const updateResult = await tx
				.update(verification_sessions)
				.set({
					...SESSION_PRIVACY_MINIMIZATION_VALUES,
					...(shouldMarkWithdrawn
						? {
								status: "cancelled" as const,
								completedAt: row.completedAt ?? now,
							}
						: {}),
				})
				.where(
					and(
						eq(verification_sessions.id, row.id),
						eq(verification_sessions.organizationId, organizationId),
						inArray(verification_sessions.status, [
							"succeeded",
							"failed",
						] as const),
					),
				)
				.returning({ id: verification_sessions.id });

			if (!(shouldMarkWithdrawn && updateResult.length > 0)) {
				return { minimized: updateResult, sessionCancelledEventId: null };
			}

			const sessionCancelledEventId = generateId({ type: "evt" });
			await tx.insert(events).values({
				id: sessionCancelledEventId,
				organizationId,
				type: "verification.session.cancelled",
				triggerId: row.id,
				triggerType: "verification_session",
			});

			return { minimized: updateResult, sessionCancelledEventId };
		});
		minimizedCompletedAttemptCount = txResult.minimized.length;

		if (txResult.sessionCancelledEventId) {
			const deliveryIds =
				await createWebhookDeliveriesForVerificationSessionCancelled({
					contractVersion: row.contractVersion,
					eventId: txResult.sessionCancelledEventId,
					livenessTriesUsed: row.livenessTriesUsed,
					nfcTriesUsed: row.nfcTriesUsed,
					organizationId,
					outcome: "not_verified",
					reason: replacementCancelledReason,
					sessionId: row.id,
				});

			await triggerWebhookDeliveryWorkflows({ env, deliveryIds });
		}
	}

	await recordAuditLog({
		actorType: "system",
		organizationId,
		event: "session.privacy_request.submitted",
		targetId: row.id,
		targetType: "verification_session",
		metadata: {
			delivered_webhook_delivery_count: scrubResult.deliveredDeliveryCount,
			minimized_completed_attempt_count: minimizedCompletedAttemptCount,
			scrubbed_webhook_payload_count: scrubResult.scrubbedDeliveryCount,
			session_status_at_request: row.status,
			total_webhook_delivery_count: scrubResult.totalDeliveryCount,
		},
	});

	return {
		deliveredWebhookDeliveryCount: scrubResult.deliveredDeliveryCount,
		minimizedCompletedAttemptCount,
		scrubbedWebhookPayloadCount: scrubResult.scrubbedDeliveryCount,
		totalWebhookDeliveryCount: scrubResult.totalDeliveryCount,
	};
}
