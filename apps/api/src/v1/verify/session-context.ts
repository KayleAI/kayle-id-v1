import type { VerifyShareRequest } from "@kayle-id/capnp/verify-codec";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { expireVerificationSessionIfNeeded } from "@/v1/sessions/repo/session-repo";
import { createShareRequestPayload } from "./share-manifest";
import { isTerminalSessionStatus } from "./status";

export type ActiveVerifySession = typeof verification_sessions.$inferSelect;

export type ActiveVerifySessionContext = {
	session: ActiveVerifySession;
	shareRequestPayload: VerifyShareRequest;
};

export async function loadActiveVerifySession(
	sessionId: string,
	{ env }: { env?: CloudflareBindings } = {},
): Promise<
	| {
			ok: false;
			code: "SESSION_EXPIRED" | "SESSION_NOT_FOUND";
	  }
	| {
			ok: true;
			value: ActiveVerifySessionContext;
	  }
> {
	const [row] = await db
		.select({
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			session: verification_sessions,
		})
		.from(verification_sessions)
		.leftJoin(
			auth_organizations,
			eq(auth_organizations.id, verification_sessions.organizationId),
		)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!row) {
		return {
			ok: false,
			code: "SESSION_NOT_FOUND",
		};
	}

	// If the verification's owning org is scheduled for deletion, treat the
	// session as if it doesn't exist publicly — no leakage of org state to
	// the verifying user.
	if (row.pendingDeletionAt) {
		return {
			ok: false,
			code: "SESSION_NOT_FOUND",
		};
	}

	const session = await expireVerificationSessionIfNeeded({
		env,
		row: row.session,
	});

	if (
		isTerminalSessionStatus(session.status) ||
		session.expiresAt.getTime() < Date.now()
	) {
		return {
			ok: false,
			code: "SESSION_EXPIRED",
		};
	}

	return {
		ok: true,
		value: {
			session,
			shareRequestPayload: createShareRequestPayload({
				contractVersion: session.contractVersion,
				sessionId: session.id,
				shareFieldsInput: session.shareFields,
			}),
		},
	};
}
