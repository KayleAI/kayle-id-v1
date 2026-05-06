import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, asc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { applyUnverifiedOrgSessionLimitInTx } from "@/v1/org-verification/rate-limit";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";
import {
	generateSessionCancelToken,
	hashSessionCancelToken,
} from "@/v1/verify/token-crypto";
import {
	createWebhookDeliveriesForVerificationSessionCancelled,
	createWebhookDeliveriesForVerificationSessionExpired,
} from "@/v1/webhooks/deliveries/service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { getVerificationSessionAnalyticsOverview } from "./session-analytics-repo";

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
	ownerVerificationOrgId?: string | null;
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
			ownerVerificationOrgId: input.ownerVerificationOrgId ?? null,
		})
		.returning();

	if (!created) {
		throw new Error("verification_session_create_returned_no_row");
	}

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
	row,
	organizationId,
}: {
	row: typeof verification_sessions.$inferSelect;
	organizationId: string;
}) {
	const now = new Date();

	const result = await db.transaction(async (tx) => {
		const sessionCancelledEventId = generateId({
			type: "evt",
		});

		await tx
			.update(verification_sessions)
			.set({
				status: "cancelled",
				completedAt: now,
			})
			.where(eq(verification_sessions.id, row.id));

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
			organizationId,
			type: "verification.session.cancelled",
			triggerId: row.id,
			triggerType: "verification_session",
		});

		return {
			sessionCancelledEventId,
		};
	});

	await createWebhookDeliveriesForVerificationSessionCancelled({
		contractVersion: row.contractVersion,
		eventId: result.sessionCancelledEventId,
		organizationId,
		sessionId: row.id,
	});
}

export async function expireVerificationSessionIfNeeded({
	now = new Date(),
	row,
}: {
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

		await tx
			.update(verification_sessions)
			.set({
				status: "expired",
				completedAt: row.completedAt ?? now,
			})
			.where(eq(verification_sessions.id, row.id));

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
			organizationId: row.organizationId,
			type: "verification.session.expired",
			triggerId: row.id,
			triggerType: "verification_session",
		});

		return {
			sessionExpiredEventId,
		};
	});

	await createWebhookDeliveriesForVerificationSessionExpired({
		contractVersion: row.contractVersion,
		eventId: result.sessionExpiredEventId,
		organizationId: row.organizationId,
		sessionId: row.id,
	});

	return {
		...row,
		status: "expired" as const,
		completedAt: row.completedAt ?? now,
	};
}

const EXPIRABLE_SESSION_STATUSES = ["created", "in_progress"] as const;
const EXPIRED_SESSION_NORMALIZATION_BATCH_SIZE = 100;
const EXPIRED_SESSION_NORMALIZATION_MAX_BATCHES = 10;

export async function normalizeExpiredVerificationSessions({
	batchSize = EXPIRED_SESSION_NORMALIZATION_BATCH_SIZE,
	maxBatches = EXPIRED_SESSION_NORMALIZATION_MAX_BATCHES,
	now = new Date(),
}: {
	batchSize?: number;
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
					inArray(verification_sessions.status, EXPIRABLE_SESSION_STATUSES),
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
