import { db } from "@kayle-id/database/drizzle";
import { verification_attempts } from "@kayle-id/database/schema/core";
import { and, eq, isNull, lt, or } from "drizzle-orm";

export const ATTEMPT_CONNECTION_ACTIVE_CODE =
	"ATTEMPT_CONNECTION_ACTIVE" as const;

const STALE_CLAIM_MS = 15 * 60_000;

type AttemptOwnershipResult =
	| {
			ok: true;
			owned: boolean;
	  }
	| {
			ok: false;
			code: typeof ATTEMPT_CONNECTION_ACTIVE_CODE;
	  };

/**
 * Claims an attempt for the given WebSocket connection. The claim is durable
 * across Worker isolate recycling because it lives in
 * `verification_attempts.claimed_by_connection_id`. A second connection
 * attempting to claim a still-live attempt is rejected with
 * `ATTEMPT_CONNECTION_ACTIVE`. Stale claims (older than 15 minutes — outlives
 * the socket lifetime cap) are recoverable so a crashed isolate cannot wedge
 * an attempt forever.
 *
 * `allowTakeover` skips the ownership filter so the new connection always wins.
 * Caller is responsible for proving the new connection is the same logical
 * client first (e.g. matching `mobileHelloDeviceIdHash` on a resume hello);
 * without that, takeover would let any peer steal an active claim. This is
 * what unblocks the iOS `reconnectForTransfer()` path after an NFC scan, where
 * the new socket's hello can race the old socket's async release.
 */
export async function claimAttemptConnection({
	attemptId,
	ownerId,
	allowTakeover = false,
}: {
	attemptId: string;
	ownerId: string;
	allowTakeover?: boolean;
}): Promise<AttemptOwnershipResult> {
	const now = new Date();
	const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);

	const idMatch = eq(verification_attempts.id, attemptId);
	const where = allowTakeover
		? idMatch
		: and(
				idMatch,
				or(
					isNull(verification_attempts.claimedByConnectionId),
					eq(verification_attempts.claimedByConnectionId, ownerId),
					lt(verification_attempts.claimedAt, staleThreshold),
				),
			);

	const claimed = await db
		.update(verification_attempts)
		.set({
			claimedByConnectionId: ownerId,
			claimedAt: now,
		})
		.where(where)
		.returning({
			id: verification_attempts.id,
			claimedBy: verification_attempts.claimedByConnectionId,
		});

	if (claimed.length === 0) {
		return {
			ok: false,
			code: ATTEMPT_CONNECTION_ACTIVE_CODE,
		};
	}

	return {
		ok: true,
		owned: true,
	};
}

export async function releaseAttemptConnection({
	attemptId,
	ownerId,
}: {
	attemptId: string;
	ownerId: string;
}): Promise<void> {
	await db
		.update(verification_attempts)
		.set({
			claimedByConnectionId: null,
			claimedAt: null,
		})
		.where(
			and(
				eq(verification_attempts.id, attemptId),
				eq(verification_attempts.claimedByConnectionId, ownerId),
			),
		);
}

export const ATTEMPT_STALE_CLAIM_MS = STALE_CLAIM_MS;
