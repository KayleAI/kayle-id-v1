import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, gt, gte, lte } from "drizzle-orm";

export function listVerificationSessions({
	organizationId,
	status,
	createdFrom,
	createdTo,
	startingAfter,
	limit,
}: {
	organizationId: string;
	status?:
		| "created"
		| "in_progress"
		| "succeeded"
		| "failed"
		| "expired"
		| "cancelled";
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
