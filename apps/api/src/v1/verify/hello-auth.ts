import { db } from "@kayle-id/database/drizzle";
import {
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, eq, inArray } from "drizzle-orm";
import { ACTIVE_SESSION_STATUSES, isTerminalAttemptStatus } from "./status";
import {
	constantTimeStringEqual,
	hashMobileDeviceId,
	hashMobileWriteToken,
} from "./token-crypto";

export type HelloPayload = {
	attemptId?: string;
	mobileWriteToken?: string;
	deviceId?: string;
	appVersion?: string;
	attestKeyId?: string;
	helloAssertion?: Uint8Array;
	runtimeIntegritySignal?: number;
};

export type ParsedHelloPayload = {
	attemptId: string;
	mobileWriteToken: string;
	deviceId: string;
	appVersion: string;
	attestKeyId: string;
	helloAssertion: Uint8Array;
	runtimeIntegritySignal: number;
};

export function parseHelloPayload(
	payload: HelloPayload,
): ParsedHelloPayload | null {
	const parsed = {
		attemptId: payload.attemptId?.trim() ?? "",
		mobileWriteToken: payload.mobileWriteToken?.trim() ?? "",
		deviceId: payload.deviceId?.trim() ?? "",
		appVersion: payload.appVersion?.trim() ?? "",
		attestKeyId: payload.attestKeyId?.trim() ?? "",
		helloAssertion: payload.helloAssertion ?? new Uint8Array(),
		runtimeIntegritySignal: payload.runtimeIntegritySignal ?? 0,
	};

	if (!(parsed.attemptId && parsed.mobileWriteToken && parsed.deviceId)) {
		return null;
	}

	return parsed;
}

export async function getAttemptForHello(
	verificationSessionId: string,
	attemptId: string,
) {
	const [attempt] = await db
		.select({
			id: verification_attempts.id,
			status: verification_attempts.status,
			mobileWriteTokenHash: verification_attempts.mobileWriteTokenHash,
			mobileWriteTokenExpiresAt:
				verification_attempts.mobileWriteTokenExpiresAt,
			mobileWriteTokenConsumedAt:
				verification_attempts.mobileWriteTokenConsumedAt,
			mobileHelloDeviceIdHash: verification_attempts.mobileHelloDeviceIdHash,
			currentPhase: verification_attempts.currentPhase,
		})
		.from(verification_attempts)
		.where(
			and(
				eq(verification_attempts.id, attemptId),
				eq(verification_attempts.verificationSessionId, verificationSessionId),
			),
		)
		.limit(1);

	return attempt ?? null;
}

export type HelloAuthState =
	| {
			kind: "error";
			code:
				| "HANDOFF_TOKEN_INVALID"
				| "HANDOFF_TOKEN_EXPIRED"
				| "HANDOFF_TOKEN_CONSUMED"
				| "HANDOFF_DEVICE_MISMATCH";
	  }
	| {
			kind: "resume";
	  }
	| {
			kind: "consume";
			deviceIdHash: string;
	  };

export async function resolveHelloAuthState({
	attempt,
	mobileWriteToken,
	deviceId,
	nowMs,
}: {
	attempt: NonNullable<Awaited<ReturnType<typeof getAttemptForHello>>>;
	mobileWriteToken: string;
	deviceId: string;
	nowMs: number;
}): Promise<HelloAuthState> {
	if (!attempt.mobileWriteTokenHash) {
		return {
			kind: "error",
			code: "HANDOFF_TOKEN_INVALID",
		};
	}

	const providedTokenHash = await hashMobileWriteToken(mobileWriteToken);
	if (
		!constantTimeStringEqual(providedTokenHash, attempt.mobileWriteTokenHash)
	) {
		return {
			kind: "error",
			code: "HANDOFF_TOKEN_INVALID",
		};
	}

	const deviceIdHash = await hashMobileDeviceId(deviceId);

	if (attempt.mobileWriteTokenConsumedAt) {
		if (!attempt.mobileHelloDeviceIdHash) {
			return {
				kind: "error",
				code: "HANDOFF_TOKEN_CONSUMED",
			};
		}

		if (
			!constantTimeStringEqual(attempt.mobileHelloDeviceIdHash, deviceIdHash)
		) {
			return {
				kind: "error",
				code: "HANDOFF_DEVICE_MISMATCH",
			};
		}

		return { kind: "resume" };
	}

	const expiresAtMs = attempt.mobileWriteTokenExpiresAt?.getTime() ?? 0;
	if (expiresAtMs <= nowMs) {
		return {
			kind: "error",
			code: "HANDOFF_TOKEN_EXPIRED",
		};
	}

	return {
		kind: "consume",
		deviceIdHash,
	};
}

export async function consumeHelloAttempt({
	attemptId,
	deviceIdHash,
	appVersion,
	mobileAttestKeyId,
}: {
	attemptId: string;
	deviceIdHash: string;
	appVersion: string;
	mobileAttestKeyId: string | null;
}): Promise<void> {
	await db
		.update(verification_attempts)
		.set({
			mobileWriteTokenConsumedAt: new Date(),
			mobileHelloDeviceIdHash: deviceIdHash,
			mobileHelloAppVersion: appVersion || null,
			mobileAttestKeyId,
		})
		.where(eq(verification_attempts.id, attemptId));
}

export async function persistFirstHelloState({
	attemptId,
	deviceIdHash,
	appVersion,
	mobileAttestKeyId,
	session,
}: {
	attemptId: string;
	deviceIdHash: string;
	appVersion: string;
	mobileAttestKeyId: string | null;
	session: {
		id: string;
		status: string;
	};
}): Promise<boolean> {
	const nextStatus = await db.transaction(async (tx) => {
		let status = session.status;

		if (status !== "in_progress") {
			const [updated] = await tx
				.update(verification_sessions)
				.set({
					status: "in_progress",
				})
				.where(
					and(
						eq(verification_sessions.id, session.id),
						inArray(verification_sessions.status, ACTIVE_SESSION_STATUSES),
					),
				)
				.returning({
					status: verification_sessions.status,
				});

			if (!updated) {
				return null;
			}

			status = updated.status;
		}

		const now = new Date();
		await tx
			.update(verification_attempts)
			.set({
				currentPhase: "mobile_connected",
				mobileAttestKeyId,
				mobileHelloAppVersion: appVersion || null,
				mobileHelloDeviceIdHash: deviceIdHash,
				mobileWriteTokenConsumedAt: now,
				phaseUpdatedAt: now,
			})
			.where(eq(verification_attempts.id, attemptId));

		return status;
	});

	if (!nextStatus) {
		return false;
	}

	session.status = nextStatus;
	return true;
}

export async function markSessionInProgress(session: {
	id: string;
	status: string;
}): Promise<boolean> {
	if (session.status === "in_progress") {
		return true;
	}

	const [updated] = await db
		.update(verification_sessions)
		.set({
			status: "in_progress",
		})
		.where(
			and(
				eq(verification_sessions.id, session.id),
				inArray(verification_sessions.status, ACTIVE_SESSION_STATUSES),
			),
		)
		.returning({
			status: verification_sessions.status,
		});

	if (!updated) {
		return false;
	}

	session.status = updated.status;
	return true;
}

export function isAttemptMissingOrTerminal(
	attempt: Awaited<ReturnType<typeof getAttemptForHello>>,
): boolean {
	if (!attempt) {
		return true;
	}

	return isTerminalAttemptStatus(attempt.status);
}
