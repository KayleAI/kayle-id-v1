import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { sql } from "drizzle-orm";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";
import { applyUnverifiedOrgSessionLimitInTx } from "@/v1/sessions/unverified-org-limit";
import {
	generateSessionCancelToken,
	hashSessionCancelToken,
} from "@/v1/verify/token-crypto";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
	webhookEndpointIds: string[] | null;
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
			webhookEndpointIds: input.webhookEndpointIds,
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

export async function createVerificationSessionWithUnverifiedOrgLimit(
	input: CreateVerificationSessionInput,
): Promise<CreateVerificationSessionWithLimitResult> {
	if (input.isAgeOnly) {
		const result = await createVerificationSession(input);
		return { ok: true, row: result.row, cancelToken: result.cancelToken };
	}

	return db.transaction(async (tx) => {
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
