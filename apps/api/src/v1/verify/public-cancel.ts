import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import {
	expireVerificationSessionIfNeeded,
	recordVerificationSessionPrivacyRequest,
} from "@/v1/sessions/repo/session-repo";
import { isPublicVerifySessionHidden } from "./public-session-visibility";
import { invalidVerifyRequestJson } from "./route-utils";
import {
	constantTimeStringEqual,
	hashSessionCancelToken,
	SESSION_CANCEL_TOKEN_LENGTH,
	SESSION_CANCEL_TOKEN_PATTERN,
} from "./token-crypto";

export const cancelBodySchema = z.object({
	cancel_token: z
		.string()
		.length(SESSION_CANCEL_TOKEN_LENGTH)
		.regex(SESSION_CANCEL_TOKEN_PATTERN),
});

export type CancelBody = z.infer<typeof cancelBodySchema>;

type CancelPublicVerifySessionErrorCode =
	| "CANCEL_TOKEN_INVALID"
	| "CANCEL_TOKEN_USED"
	| "SESSION_NOT_FOUND";

type CancelPublicVerifySessionResult =
	| { ok: true }
	| {
			error: {
				code: CancelPublicVerifySessionErrorCode;
				status: 401 | 404;
			};
			ok: false;
	  };

const TERMINAL_CANCEL_STATUSES = ["completed", "expired", "cancelled"] as const;

export function cancelBodyJsonValidator(
	value: unknown,
	c: Context,
): CancelBody | Response {
	const parsed = cancelBodySchema.safeParse(value);
	if (parsed.success) {
		return parsed.data;
	}

	return invalidVerifyRequestJson(c);
}

function cancelError(
	code: CancelPublicVerifySessionErrorCode,
	status: 401 | 404,
): CancelPublicVerifySessionResult {
	return {
		error: { code, status },
		ok: false,
	};
}

function isTerminalCancelStatus(status: string): boolean {
	return (TERMINAL_CANCEL_STATUSES as readonly string[]).includes(status);
}

export async function cancelPublicVerifySession({
	env,
	providedToken,
	sessionId,
}: {
	env: CloudflareBindings;
	providedToken: string;
	sessionId: string;
}): Promise<CancelPublicVerifySessionResult> {
	const [rawSession] = await db
		.select()
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!rawSession) {
		return cancelError("SESSION_NOT_FOUND", 404);
	}

	if (await isPublicVerifySessionHidden(rawSession.organizationId)) {
		return cancelError("SESSION_NOT_FOUND", 404);
	}

	if (!rawSession.cancelTokenHash) {
		return cancelError("CANCEL_TOKEN_INVALID", 401);
	}

	const providedTokenHash = await hashSessionCancelToken(providedToken);
	if (!constantTimeStringEqual(providedTokenHash, rawSession.cancelTokenHash)) {
		return cancelError("CANCEL_TOKEN_INVALID", 401);
	}

	const session = await expireVerificationSessionIfNeeded({
		env,
		row: rawSession,
	});

	if (rawSession.cancelTokenConsumedAt) {
		return isTerminalCancelStatus(session.status)
			? { ok: true }
			: cancelError("CANCEL_TOKEN_USED", 401);
	}

	const [consumedCancelToken] = await db
		.update(verification_sessions)
		.set({ cancelTokenConsumedAt: new Date() })
		.where(
			and(
				eq(verification_sessions.id, session.id),
				isNull(verification_sessions.cancelTokenConsumedAt),
			),
		)
		.returning({ id: verification_sessions.id });

	if (!consumedCancelToken) {
		const [latestSession] = await db
			.select({
				cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
				status: verification_sessions.status,
			})
			.from(verification_sessions)
			.where(eq(verification_sessions.id, session.id))
			.limit(1);

		if (
			latestSession?.cancelTokenConsumedAt &&
			isTerminalCancelStatus(latestSession.status)
		) {
			return { ok: true };
		}

		return cancelError("CANCEL_TOKEN_USED", 401);
	}

	await recordVerificationSessionPrivacyRequest({
		env,
		row: session,
		organizationId: session.organizationId,
	});

	return { ok: true };
}
