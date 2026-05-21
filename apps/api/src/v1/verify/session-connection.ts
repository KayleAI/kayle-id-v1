import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, isNull, lt, or } from "drizzle-orm";

export const SESSION_CONNECTION_ACTIVE_CODE =
	"SESSION_CONNECTION_ACTIVE" as const;

const STALE_CLAIM_MS = 15 * 60_000;

type ClaimResult =
	| { ok: true; owned: boolean }
	| { ok: false; code: typeof SESSION_CONNECTION_ACTIVE_CODE };

/**
 * Claim a session for the given WebSocket connection. The claim is durable
 * across Worker isolate recycling because it lives in
 * `verification_sessions.claimed_by_connection_id`. A second connection
 * attempting to claim a still-live session is rejected with
 * `SESSION_CONNECTION_ACTIVE`. Stale claims (older than 15 minutes — outlives
 * the socket lifetime cap) are recoverable so a crashed isolate cannot wedge a
 * session forever.
 *
 * `allowTakeover` skips the ownership filter so the new connection always
 * wins. Caller is responsible for proving the new connection is the same
 * logical client first (e.g. matching `mobileHelloDeviceIdHash` on a resume
 * hello); without that, takeover would let any peer steal an active claim.
 * This is what unblocks the iOS `reconnectForTransfer()` path after an NFC
 * scan, where the new socket's hello can race the old socket's async release.
 */
export async function claimSessionConnection({
	sessionId,
	ownerId,
	allowTakeover = false,
}: {
	sessionId: string;
	ownerId: string;
	allowTakeover?: boolean;
}): Promise<ClaimResult> {
	const now = new Date();
	const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);

	const idMatch = eq(verification_sessions.id, sessionId);
	const where = allowTakeover
		? idMatch
		: and(
				idMatch,
				or(
					isNull(verification_sessions.claimedByConnectionId),
					eq(verification_sessions.claimedByConnectionId, ownerId),
					lt(verification_sessions.claimedAt, staleThreshold),
				),
			);

	const claimed = await db
		.update(verification_sessions)
		.set({
			claimedByConnectionId: ownerId,
			claimedAt: now,
		})
		.where(where)
		.returning({
			id: verification_sessions.id,
			claimedBy: verification_sessions.claimedByConnectionId,
		});

	if (claimed.length === 0) {
		return { ok: false, code: SESSION_CONNECTION_ACTIVE_CODE };
	}

	return { ok: true, owned: true };
}

export async function releaseSessionConnection({
	sessionId,
	ownerId,
}: {
	sessionId: string;
	ownerId: string;
}): Promise<void> {
	await db
		.update(verification_sessions)
		.set({
			claimedByConnectionId: null,
			claimedAt: null,
		})
		.where(
			and(
				eq(verification_sessions.id, sessionId),
				eq(verification_sessions.claimedByConnectionId, ownerId),
			),
		);
}

export const SESSION_STALE_CLAIM_MS = STALE_CLAIM_MS;
