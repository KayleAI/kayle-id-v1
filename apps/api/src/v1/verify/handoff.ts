import { db } from "@kayle-id/database/drizzle";
import {
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { desc, eq, sql } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { expireVerificationSessionIfNeeded } from "@/v1/sessions/repo/session-repo";
import {
	deriveAttestHelloChallenge,
	deriveAttestNfcChallenge,
} from "./attest-challenges";
import { isPublicVerifySessionHidden } from "./public-session-visibility";
import { isTerminalSessionStatus } from "./status";
import {
	deriveMobileWriteToken,
	generateMobileWriteTokenSeed,
	hashMobileWriteToken,
} from "./token-crypto";

const HANDOFF_TOKEN_TTL_MS = 5 * 60_000;
const HANDOFF_PAYLOAD_VERSION = 1;

type HandoffError = {
	code: "SESSION_NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_IN_PROGRESS";
	status: 404 | 409 | 410;
};

type HandoffSuccess = {
	v: number;
	session_id: string;
	attempt_id: string;
	mobile_write_token: string;
	expires_at: string;
	attest_hello_challenge: string;
	attest_nfc_challenge: string;
};

type SelectedHandoffAttempt =
	| {
			ok: false;
			error: HandoffError;
	  }
	| {
			ok: true;
			attemptId: string;
			expiresAt: Date;
			issuedAt: Date;
			mobileWriteTokenSeed: string;
	  };

export type IssueHandoffResult =
	| {
			ok: false;
			error: HandoffError;
	  }
	| {
			ok: true;
			data: HandoffSuccess;
	  };

export async function issueHandoffPayload(
	sessionId: string,
	{
		env,
		now = new Date(),
	}: {
		env?: CloudflareBindings;
		now?: Date;
	} = {},
): Promise<IssueHandoffResult> {
	const [session] = await db
		.select({
			id: verification_sessions.id,
			organizationId: verification_sessions.organizationId,
			status: verification_sessions.status,
			completedAt: verification_sessions.completedAt,
			createdAt: verification_sessions.createdAt,
			redirectUrl: verification_sessions.redirectUrl,
			shareFields: verification_sessions.shareFields,
			contractVersion: verification_sessions.contractVersion,
			expiresAt: verification_sessions.expiresAt,
			updatedAt: verification_sessions.updatedAt,
			cancelTokenHash: verification_sessions.cancelTokenHash,
			cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
			isAgeOnly: verification_sessions.isAgeOnly,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!session) {
		return {
			ok: false,
			error: {
				code: "SESSION_NOT_FOUND",
				status: 404,
			},
		};
	}

	if (await isPublicVerifySessionHidden(session.organizationId)) {
		return {
			ok: false,
			error: {
				code: "SESSION_NOT_FOUND",
				status: 404,
			},
		};
	}

	const normalizedSession = await expireVerificationSessionIfNeeded({
		env,
		now,
		row: session,
	});

	if (
		isTerminalSessionStatus(normalizedSession.status) ||
		normalizedSession.expiresAt.getTime() < now.getTime()
	) {
		return {
			ok: false,
			error: {
				code: "SESSION_EXPIRED",
				status: 410,
			},
		};
	}

	if (normalizedSession.status === "in_progress") {
		return {
			ok: false,
			error: {
				code: "SESSION_IN_PROGRESS",
				status: 409,
			},
		};
	}

	const selectedAttempt = await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${session.id}::text, 1))`,
		);

		const [latestAttempt] = await tx
			.select({
				id: verification_attempts.id,
				status: verification_attempts.status,
				mobileWriteTokenSeed: verification_attempts.mobileWriteTokenSeed,
				mobileWriteTokenHash: verification_attempts.mobileWriteTokenHash,
				mobileWriteTokenIssuedAt:
					verification_attempts.mobileWriteTokenIssuedAt,
				mobileWriteTokenExpiresAt:
					verification_attempts.mobileWriteTokenExpiresAt,
				mobileWriteTokenConsumedAt:
					verification_attempts.mobileWriteTokenConsumedAt,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.verificationSessionId, session.id))
			.orderBy(desc(verification_attempts.createdAt))
			.limit(1);

		if (
			latestAttempt?.status === "in_progress" &&
			latestAttempt.mobileWriteTokenConsumedAt
		) {
			return {
				ok: false,
				error: {
					code: "SESSION_IN_PROGRESS",
					status: 409,
				},
			} satisfies SelectedHandoffAttempt;
		}

		const canReuseAttempt = Boolean(
			latestAttempt &&
				latestAttempt.status === "in_progress" &&
				latestAttempt.mobileWriteTokenSeed &&
				latestAttempt.mobileWriteTokenHash &&
				latestAttempt.mobileWriteTokenIssuedAt &&
				latestAttempt.mobileWriteTokenExpiresAt &&
				!latestAttempt.mobileWriteTokenConsumedAt &&
				latestAttempt.mobileWriteTokenExpiresAt.getTime() > now.getTime(),
		);

		if (
			canReuseAttempt &&
			latestAttempt?.mobileWriteTokenIssuedAt &&
			latestAttempt.mobileWriteTokenExpiresAt &&
			latestAttempt.mobileWriteTokenSeed
		) {
			return {
				ok: true,
				attemptId: latestAttempt.id,
				issuedAt: latestAttempt.mobileWriteTokenIssuedAt,
				expiresAt: latestAttempt.mobileWriteTokenExpiresAt,
				mobileWriteTokenSeed: latestAttempt.mobileWriteTokenSeed,
			} satisfies SelectedHandoffAttempt;
		}

		const attemptId = generateId({
			type: "va",
		});
		const issuedAt = now;
		const expiresAt = new Date(now.getTime() + HANDOFF_TOKEN_TTL_MS);
		const mobileWriteTokenSeed = generateMobileWriteTokenSeed();
		const token = await deriveMobileWriteToken({
			sessionId: session.id,
			attemptId,
			issuedAt,
			seed: mobileWriteTokenSeed,
		});
		const tokenHash = await hashMobileWriteToken(token);

		await tx.insert(verification_attempts).values({
			id: attemptId,
			verificationSessionId: session.id,
			status: "in_progress",
			mobileWriteTokenSeed,
			mobileWriteTokenHash: tokenHash,
			mobileWriteTokenIssuedAt: issuedAt,
			mobileWriteTokenExpiresAt: expiresAt,
			mobileWriteTokenConsumedAt: null,
		});

		return {
			ok: true,
			attemptId,
			issuedAt,
			expiresAt,
			mobileWriteTokenSeed,
		} satisfies SelectedHandoffAttempt;
	});

	if (!selectedAttempt.ok) {
		return selectedAttempt;
	}

	const mobileWriteToken = await deriveMobileWriteToken({
		sessionId: session.id,
		attemptId: selectedAttempt.attemptId,
		issuedAt: selectedAttempt.issuedAt,
		seed: selectedAttempt.mobileWriteTokenSeed,
	});

	const [attestHelloChallenge, attestNfcChallenge] = env?.AUTH_SECRET
		? await Promise.all([
				deriveAttestHelloChallenge({
					attemptId: selectedAttempt.attemptId,
					authSecret: env.AUTH_SECRET,
				}),
				deriveAttestNfcChallenge({
					attemptId: selectedAttempt.attemptId,
					authSecret: env.AUTH_SECRET,
				}),
			])
		: [new Uint8Array(), new Uint8Array()];

	return {
		ok: true,
		data: {
			v: HANDOFF_PAYLOAD_VERSION,
			session_id: session.id,
			attempt_id: selectedAttempt.attemptId,
			mobile_write_token: mobileWriteToken,
			expires_at: selectedAttempt.expiresAt.toISOString(),
			attest_hello_challenge: bytesToBase64Url(attestHelloChallenge),
			attest_nfc_challenge: bytesToBase64Url(attestNfcChallenge),
		},
	};
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}
