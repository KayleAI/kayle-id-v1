import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, asc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";
import { applyUnverifiedOrgSessionLimitInTx } from "@/v1/sessions/unverified-org-limit";
import { ACTIVE_SESSION_STATUSES } from "@/v1/verify/status";
import {
	generateSessionCancelToken,
	hashSessionCancelToken,
} from "@/v1/verify/token-crypto";
import {
	createWebhookDeliveriesForVerificationSessionCancelled,
	createWebhookDeliveriesForVerificationSessionExpired,
	triggerWebhookDeliveryWorkflows,
} from "@/v1/webhooks/deliveries/service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { getVerificationSessionAnalyticsOverview } from "./session-analytics-repo";

const EXPIRED_SESSION_NORMALIZATION_BATCH_SIZE = 100;
const EXPIRED_SESSION_NORMALIZATION_MAX_BATCHES = 10;

export function listVerificationSessions({
	organizationId,
	status,
	createdFrom,
	createdTo,
	startingAfter,
	limit,
}: {
	organizationId: string;
	status?: "created" | "in_progress" | "completed" | "expired" | "cancelled";
	createdFrom?: string;
	createdTo?: string;
	startingAfter?: string;
	limit: number;
}) {
	const where = and(
		eq(verification_sessions.organizationId, organizationId),
		...(status ? [eq(verification_sessions.status, status)] : []),
		...(createdFrom
			? [gte(verification_sessions.createdAt, new Date(createdFrom))]
			: []),
		...(createdTo
			? [lte(verification_sessions.createdAt, new Date(createdTo))]
			: []),
		...(startingAfter ? [gt(verification_sessions.id, startingAfter)] : []),
	);

	return db
		.select()
		.from(verification_sessions)
		.where(where)
		.orderBy(verification_sessions.id)
		.limit(limit + 1);
}

export async function getVerificationSessionById({
	id,
	organizationId,
}: {
	id: string;
	organizationId: string;
}) {
	const [row] = await db
		.select()
		.from(verification_sessions)
		.where(
			and(
				eq(verification_sessions.id, id),
				eq(verification_sessions.organizationId, organizationId),
			),
		)
		.limit(1);

	return row;
}

export function getAttemptsBySessionId(sessionId: string) {
	return db
		.select()
		.from(verification_attempts)
		.where(eq(verification_attempts.verificationSessionId, sessionId));
}

export function getAttemptsBySessionIds(sessionIds: string[]) {
	if (sessionIds.length === 0) {
		return [];
	}

	return db
		.select()
		.from(verification_attempts)
		.where(inArray(verification_attempts.verificationSessionId, sessionIds));
}

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

export type CreatedVerificationSession = {
	row: typeof verification_sessions.$inferSelect;
	cancelToken: string;
};

export type CreateVerificationSessionInput = {
	id: string;
	organizationId: string;
	redirectUrl: string | null;
	shareFields: ShareFields;
	contractVersion: number;
	isAgeOnly: boolean;
};

async function insertVerificationSessionRow(
	tx: Tx,
	input: CreateVerificationSessionInput,
): Promise<CreatedVerificationSession> {
	const cancelToken = generateSessionCancelToken();
	const cancelTokenHash = await hashSessionCancelToken(cancelToken);

	const [created] = await tx
		.insert(verification_sessions)
		.values({
			id: input.id,
			organizationId: input.organizationId,
			status: "created",
			redirectUrl: input.redirectUrl,
			shareFields: input.shareFields,
			contractVersion: input.contractVersion,
			cancelTokenHash,
			isAgeOnly: input.isAgeOnly,
		})
		.returning();

	if (!created) {
		throw new Error("verification_session_create_returned_no_row");
	}

	await recordAuditLog(
		{
			actorType: "system",
			organizationId: created.organizationId,
			event: "session.created",
			targetId: created.id,
			targetType: "verification_session",
			metadata: {
				is_age_only: created.isAgeOnly,
				share_field_count: Object.keys(input.shareFields).length,
			},
		},
		tx,
	);

	return { row: created, cancelToken };
}

export async function createVerificationSession(
	input: CreateVerificationSessionInput,
): Promise<CreatedVerificationSession> {
	return db.transaction((tx) => insertVerificationSessionRow(tx, input));
}

export type CreateVerificationSessionWithLimitResult =
	| {
			ok: true;
			row: typeof verification_sessions.$inferSelect;
			cancelToken: string;
	  }
	| {
			ok: false;
			rejected: { current: number; limit: number; resetAt: Date };
	  };

/**
 * Create a verification session with the unverified-org rolling-window limit
 * enforced strictly: the per-org `pg_advisory_xact_lock` and the count + insert
 * all run inside the same transaction, so two concurrent identity-session
 * creates can't both observe count=4 and both insert.
 *
 * Age-only and verified-org cases skip the lock entirely (they're exempt by
 * design and we don't want to serialize unrelated traffic on the same key).
 */
export async function createVerificationSessionWithUnverifiedOrgLimit(
	input: CreateVerificationSessionInput,
): Promise<CreateVerificationSessionWithLimitResult> {
	if (input.isAgeOnly) {
		const result = await createVerificationSession(input);
		return { ok: true, row: result.row, cancelToken: result.cancelToken };
	}

	return db.transaction(async (tx) => {
		// Per-org advisory lock; held only for this transaction. `hashtextextended`
		// folds the UUID into a bigint key — collisions across orgs would only
		// cause needless serialization, never incorrect counting.
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId}::text, 0))`,
		);

		const decision = await applyUnverifiedOrgSessionLimitInTx(tx, {
			organizationId: input.organizationId,
			isAgeOnly: input.isAgeOnly,
		});

		if (decision.kind === "rejected") {
			return {
				ok: false,
				rejected: {
					current: decision.current,
					limit: decision.limit,
					resetAt: decision.resetAt,
				},
			} satisfies CreateVerificationSessionWithLimitResult;
		}

		const result = await insertVerificationSessionRow(tx, input);
		return {
			ok: true,
			row: result.row,
			cancelToken: result.cancelToken,
		} satisfies CreateVerificationSessionWithLimitResult;
	});
}

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
				organizationId: verification_sessions.organizationId,
			});

		if (!cancelled) {
			return null;
		}

		await tx
			.update(verification_attempts)
			.set({
				status: "failed",
				failureCode: "session_cancelled",
				completedAt: now,
			})
			.where(
				and(
					eq(verification_attempts.verificationSessionId, row.id),
					eq(verification_attempts.status, "in_progress"),
				),
			);

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
			organizationId: cancelled.organizationId,
			sessionCancelledEventId,
			sessionId: cancelled.id,
		};
	});

	if (!result) {
		return;
	}

	const deliveryIds =
		await createWebhookDeliveriesForVerificationSessionCancelled({
			contractVersion: result.contractVersion,
			eventId: result.sessionCancelledEventId,
			organizationId: result.organizationId,
			sessionId: result.sessionId,
		});

	await triggerWebhookDeliveryWorkflows({ env, deliveryIds });
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
		row.status === "completed" ||
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

		await tx
			.update(verification_attempts)
			.set({
				status: "failed",
				failureCode: "session_expired",
				completedAt: now,
			})
			.where(
				and(
					eq(verification_attempts.verificationSessionId, row.id),
					eq(verification_attempts.status, "in_progress"),
				),
			);

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
