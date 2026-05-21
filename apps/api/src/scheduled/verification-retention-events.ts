import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import { events } from "@kayle-id/database/schema/core";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import {
	and,
	asc,
	eq,
	exists,
	inArray,
	isNotNull,
	lte,
	not,
	sql,
} from "drizzle-orm";
import {
	subtractDays,
	VERIFICATION_AUDIT_LOG_EVENTS,
	VERIFICATION_AUDIT_LOG_RETENTION_DAYS,
	VERIFICATION_EVENT_RETENTION_DAYS,
	VERIFICATION_EVENT_TYPES,
} from "./verification-retention-config";

export async function deleteVerificationEvents({
	batchSize,
	now,
}: {
	batchSize: number;
	now: Date;
}): Promise<number> {
	const cutoff = subtractDays(now, VERIFICATION_EVENT_RETENTION_DAYS);
	const staleRows = await db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				inArray(events.type, VERIFICATION_EVENT_TYPES),
				lte(events.createdAt, cutoff),
				not(
					exists(
						db
							.select({ presence: sql`1` })
							.from(webhook_deliveries)
							.where(
								and(
									eq(webhook_deliveries.eventId, events.id),
									isNotNull(webhook_deliveries.payload),
								),
							),
					),
				),
			),
		)
		.orderBy(asc(events.createdAt))
		.limit(batchSize);

	if (staleRows.length === 0) {
		return 0;
	}

	const deletedRows = await db
		.delete(events)
		.where(
			inArray(
				events.id,
				staleRows.map((row) => row.id),
			),
		)
		.returning({ id: events.id });

	return deletedRows.length;
}

export async function deleteVerificationAuditLogs({
	batchSize,
	now,
}: {
	batchSize: number;
	now: Date;
}): Promise<number> {
	const cutoff = subtractDays(now, VERIFICATION_AUDIT_LOG_RETENTION_DAYS);
	const staleRows = await db
		.select({ id: audit_logs.id })
		.from(audit_logs)
		.where(
			and(
				inArray(audit_logs.event, VERIFICATION_AUDIT_LOG_EVENTS),
				lte(audit_logs.createdAt, cutoff),
			),
		)
		.orderBy(asc(audit_logs.createdAt))
		.limit(batchSize);

	if (staleRows.length === 0) {
		return 0;
	}

	const deletedRows = await db
		.delete(audit_logs)
		.where(
			inArray(
				audit_logs.id,
				staleRows.map((row) => row.id),
			),
		)
		.returning({ id: audit_logs.id });

	return deletedRows.length;
}
