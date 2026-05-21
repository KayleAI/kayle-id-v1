import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { events, verification_sessions } from "@kayle-id/database/schema/core";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { ACTIVE_SESSION_STATUSES } from "@/v1/verify/status";
import {
	createWebhookDeliveriesForVerificationSessionExpired,
	triggerWebhookDeliveryWorkflows,
} from "@/v1/webhooks/deliveries/service";
import {
	EXPIRED_SESSION_NORMALIZATION_BATCH_SIZE,
	EXPIRED_SESSION_NORMALIZATION_MAX_BATCHES,
} from "./session-lifecycle-config";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getLatestVerificationSessionById(
	sessionId: string,
	tx: Tx,
): Promise<typeof verification_sessions.$inferSelect | null> {
	const [latest] = await tx
		.select()
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	return latest ?? null;
}

export async function expireVerificationSessionIfNeeded({
	env,
	now = new Date(),
	row,
}: {
	env?: CloudflareBindings;
	now?: Date;
	row: typeof verification_sessions.$inferSelect;
}) {
	if (
		row.status === "expired" ||
		row.status === "succeeded" ||
		row.status === "failed" ||
		row.status === "cancelled" ||
		row.expiresAt.getTime() > now.getTime()
	) {
		return row;
	}

	const result = await db.transaction(async (tx) => {
		const sessionExpiredEventId = generateId({
			type: "evt",
		});

		const [expired] = await tx
			.update(verification_sessions)
			.set({
				status: "expired",
				completedAt: row.completedAt ?? now,
			})
			.where(
				and(
					eq(verification_sessions.id, row.id),
					inArray(verification_sessions.status, ACTIVE_SESSION_STATUSES),
					lte(verification_sessions.expiresAt, now),
				),
			)
			.returning();

		if (!expired) {
			return {
				session: await getLatestVerificationSessionById(row.id, tx),
				sessionExpiredEventId: null,
			};
		}

		await tx.insert(events).values({
			id: sessionExpiredEventId,
			organizationId: expired.organizationId,
			type: "verification.session.expired",
			triggerId: expired.id,
			triggerType: "verification_session",
		});

		await recordAuditLog(
			{
				actorType: "system",
				organizationId: expired.organizationId,
				event: "session.expired",
				targetId: expired.id,
				targetType: "verification_session",
			},
			tx,
		);

		return {
			session: expired,
			sessionExpiredEventId,
		};
	});

	if (!result.sessionExpiredEventId) {
		return result.session ?? row;
	}

	const deliveryIds =
		await createWebhookDeliveriesForVerificationSessionExpired({
			contractVersion: result.session.contractVersion,
			eventId: result.sessionExpiredEventId,
			organizationId: result.session.organizationId,
			sessionId: result.session.id,
		});

	await triggerWebhookDeliveryWorkflows({ env, deliveryIds });

	return result.session;
}

export async function normalizeExpiredVerificationSessions({
	batchSize = EXPIRED_SESSION_NORMALIZATION_BATCH_SIZE,
	env,
	maxBatches = EXPIRED_SESSION_NORMALIZATION_MAX_BATCHES,
	now = new Date(),
}: {
	batchSize?: number;
	env?: CloudflareBindings;
	maxBatches?: number;
	now?: Date;
} = {}): Promise<number> {
	let processed = 0;

	for (let batch = 0; batch < maxBatches; batch += 1) {
		const rows = await db
			.select()
			.from(verification_sessions)
			.where(
				and(
					inArray(verification_sessions.status, ACTIVE_SESSION_STATUSES),
					lte(verification_sessions.expiresAt, now),
				),
			)
			.orderBy(asc(verification_sessions.expiresAt))
			.limit(batchSize);

		if (rows.length === 0) {
			break;
		}

		for (const row of rows) {
			await expireVerificationSessionIfNeeded({
				env,
				now,
				row,
			});
			processed += 1;
		}

		if (rows.length < batchSize) {
			break;
		}
	}

	return processed;
}
