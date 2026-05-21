import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, inArray } from "drizzle-orm";
import { ACTIVE_SESSION_STATUSES, isTerminalSessionStatus } from "./status";
import {
	constantTimeStringEqual,
	hashMobileDeviceId,
	hashMobileWriteToken,
} from "./token-crypto";

export type HelloPayload = {
	sessionId?: string;
	mobileWriteToken?: string;
	deviceId?: string;
	appVersion?: string;
	attestKeyId?: string;
	helloAssertion?: Uint8Array;
	runtimeIntegritySignal?: number;
};

export type ParsedHelloPayload = {
	sessionId: string;
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
		sessionId: payload.sessionId?.trim() ?? "",
		mobileWriteToken: payload.mobileWriteToken?.trim() ?? "",
		deviceId: payload.deviceId?.trim() ?? "",
		appVersion: payload.appVersion?.trim() ?? "",
		attestKeyId: payload.attestKeyId?.trim() ?? "",
		helloAssertion: payload.helloAssertion ?? new Uint8Array(),
		runtimeIntegritySignal: payload.runtimeIntegritySignal ?? 0,
	};

	if (!(parsed.sessionId && parsed.mobileWriteToken && parsed.deviceId)) {
		return null;
	}

	return parsed;
}

export async function getSessionForHello(sessionId: string) {
	const [session] = await db
		.select({
			id: verification_sessions.id,
			status: verification_sessions.status,
			mobileWriteTokenHash: verification_sessions.mobileWriteTokenHash,
			mobileWriteTokenExpiresAt:
				verification_sessions.mobileWriteTokenExpiresAt,
			mobileWriteTokenConsumedAt:
				verification_sessions.mobileWriteTokenConsumedAt,
			mobileHelloDeviceIdHash: verification_sessions.mobileHelloDeviceIdHash,
			currentPhase: verification_sessions.currentPhase,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	return session ?? null;
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
	session,
	mobileWriteToken,
	deviceId,
	nowMs,
}: {
	session: NonNullable<Awaited<ReturnType<typeof getSessionForHello>>>;
	mobileWriteToken: string;
	deviceId: string;
	nowMs: number;
}): Promise<HelloAuthState> {
	if (!session.mobileWriteTokenHash) {
		return { kind: "error", code: "HANDOFF_TOKEN_INVALID" };
	}

	const providedTokenHash = await hashMobileWriteToken(mobileWriteToken);
	if (
		!constantTimeStringEqual(providedTokenHash, session.mobileWriteTokenHash)
	) {
		return { kind: "error", code: "HANDOFF_TOKEN_INVALID" };
	}

	const deviceIdHash = await hashMobileDeviceId(deviceId);

	if (session.mobileWriteTokenConsumedAt) {
		if (!session.mobileHelloDeviceIdHash) {
			return { kind: "error", code: "HANDOFF_TOKEN_CONSUMED" };
		}

		if (
			!constantTimeStringEqual(session.mobileHelloDeviceIdHash, deviceIdHash)
		) {
			return { kind: "error", code: "HANDOFF_DEVICE_MISMATCH" };
		}

		return { kind: "resume" };
	}

	const expiresAtMs = session.mobileWriteTokenExpiresAt?.getTime() ?? 0;
	if (expiresAtMs <= nowMs) {
		return { kind: "error", code: "HANDOFF_TOKEN_EXPIRED" };
	}

	return { kind: "consume", deviceIdHash };
}

export async function consumeHelloHandoff({
	sessionId,
	deviceIdHash,
	appVersion,
	mobileAttestKeyId,
}: {
	sessionId: string;
	deviceIdHash: string;
	appVersion: string;
	mobileAttestKeyId: string | null;
}): Promise<void> {
	await db
		.update(verification_sessions)
		.set({
			mobileWriteTokenConsumedAt: new Date(),
			mobileHelloDeviceIdHash: deviceIdHash,
			mobileHelloAppVersion: appVersion || null,
			mobileAttestKeyId,
		})
		.where(eq(verification_sessions.id, sessionId));
}

export async function persistFirstHelloState({
	deviceIdHash,
	appVersion,
	mobileAttestKeyId,
	session,
}: {
	deviceIdHash: string;
	appVersion: string;
	mobileAttestKeyId: string | null;
	session: {
		id: string;
		status: string;
	};
}): Promise<boolean> {
	const nextStatus = await db.transaction(async (tx) => {
		const now = new Date();

		const [updated] = await tx
			.update(verification_sessions)
			.set({
				status: "in_progress",
				currentPhase: "mobile_connected",
				mobileAttestKeyId,
				mobileHelloAppVersion: appVersion || null,
				mobileHelloDeviceIdHash: deviceIdHash,
				mobileWriteTokenConsumedAt: now,
				phaseUpdatedAt: now,
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

		return updated?.status ?? null;
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

export function isSessionMissingOrTerminal(
	session: Awaited<ReturnType<typeof getSessionForHello>>,
): boolean {
	if (!session) {
		return true;
	}

	return isTerminalSessionStatus(session.status);
}
