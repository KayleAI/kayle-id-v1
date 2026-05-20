import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { expireVerificationSessionIfNeeded } from "@/v1/sessions/repo/session-repo";
import { isPublicVerifySessionHidden } from "./public-session-visibility";
import { isTerminalSessionStatus } from "./status";

export type PublicVerifyAttemptStatus = {
	completed_at: string | null;
	failure_code: string | null;
	handoff_claimed: boolean;
	id: string;
	retry_allowed: boolean;
	status: "cancelled" | "failed" | "in_progress" | "succeeded";
};

export type PublicVerifySessionStatus = {
	completed_at: string | null;
	is_terminal: boolean;
	latest_attempt: PublicVerifyAttemptStatus | null;
	redirect_url: string | null;
	session_id: string;
	same_device_only: boolean;
	status:
		| "cancelled"
		| "created"
		| "expired"
		| "failed"
		| "in_progress"
		| "succeeded";
};

export async function getPublicVerifySessionStatus({
	env,
	now = new Date(),
	sessionId,
}: {
	env?: CloudflareBindings;
	now?: Date;
	sessionId: string;
}): Promise<PublicVerifySessionStatus | null> {
	const [rawSession] = await db
		.select()
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!rawSession) {
		return null;
	}

	if (await isPublicVerifySessionHidden(rawSession.organizationId)) {
		return null;
	}

	const session = await expireVerificationSessionIfNeeded({
		env,
		now,
		row: rawSession,
	});

	const isTerminal = isTerminalSessionStatus(session.status);
	const sessionFailed = session.status === "failed";
	const sessionSucceeded = session.status === "succeeded";

	let attemptStatus: PublicVerifyAttemptStatus["status"] | null = null;
	if (session.status === "in_progress" || session.status === "created") {
		attemptStatus = session.mobileWriteTokenConsumedAt ? "in_progress" : null;
	} else if (sessionSucceeded) {
		attemptStatus = "succeeded";
	} else if (sessionFailed) {
		attemptStatus = "failed";
	} else if (session.status === "cancelled") {
		attemptStatus = "cancelled";
	}

	const latestAttempt: PublicVerifyAttemptStatus | null = attemptStatus
		? {
				completed_at: session.completedAt?.toISOString() ?? null,
				failure_code: session.failureCode ?? null,
				handoff_claimed: Boolean(
					session.mobileWriteTokenConsumedAt || session.mobileHelloDeviceIdHash,
				),
				id: session.id,
				retry_allowed: false,
				status: attemptStatus,
			}
		: null;

	return {
		completed_at: session.completedAt?.toISOString() ?? null,
		is_terminal: isTerminal,
		latest_attempt: latestAttempt,
		redirect_url: session.redirectUrl ?? null,
		session_id: session.id,
		same_device_only: Boolean(
			session.mobileWriteTokenConsumedAt || session.mobileHelloDeviceIdHash,
		),
		status: session.status,
	};
}
