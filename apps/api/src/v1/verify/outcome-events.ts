import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import type { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import { generateId } from "@/utils/generate-id";
import type { SessionContext } from "./outcome-types";
import type { CheckKind, NegativeFailureCode } from "./retry-limits";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordCheckFailedAuditLog(
	tx: Tx,
	{
		session,
		failureCode,
		failedCheck,
	}: {
		session: SessionContext;
		failureCode: NegativeFailureCode;
		failedCheck: Exclude<CheckKind, "mrz">;
	},
): Promise<void> {
	await recordAuditLog(
		{
			actorType: "system",
			organizationId: session.organizationId,
			event: "session.check.failed",
			targetId: session.id,
			targetType: "verification_session",
			metadata: { failure_code: failureCode, failed_check: failedCheck },
		},
		tx,
	);
}

export async function createSessionFailedEvent(
	tx: Tx,
	{
		session,
		failureCode,
		nfcTriesUsed,
		livenessTriesUsed,
		failedCheck,
	}: {
		session: SessionContext;
		failureCode: NegativeFailureCode;
		nfcTriesUsed: number;
		livenessTriesUsed: number;
		failedCheck?: Exclude<CheckKind, "mrz">;
	},
): Promise<string> {
	const sessionFailedEventId = generateId({ type: "evt" });
	await tx.insert(events).values({
		id: sessionFailedEventId,
		organizationId: session.organizationId,
		type: "verification.session.failed",
		triggerId: session.id,
		triggerType: "verification_session",
	});

	await recordAuditLog(
		{
			actorType: "system",
			organizationId: session.organizationId,
			event: "session.failed",
			targetId: session.id,
			targetType: "verification_session",
			metadata: {
				failure_code: failureCode,
				...(failedCheck ? { failed_check: failedCheck } : {}),
				nfc_tries_used: nfcTriesUsed,
				liveness_tries_used: livenessTriesUsed,
			},
		},
		tx,
	);

	return sessionFailedEventId;
}
