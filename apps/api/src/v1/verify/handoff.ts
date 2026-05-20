import { env as configEnv } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import {
	verification_consents,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { eq, sql } from "drizzle-orm";
import { expireVerificationSessionIfNeeded } from "@/v1/sessions/repo/session-repo";
import {
	deriveAttestHelloChallenge,
	deriveAttestNfcChallenge,
} from "./attest-challenges";
import { isTerminalSessionStatus } from "./status";
import {
	deriveMobileWriteToken,
	generateMobileWriteTokenSeed,
	hashMobileWriteToken,
} from "./token-crypto";

const HANDOFF_TOKEN_TTL_MS = 5 * 60_000;
const HANDOFF_PAYLOAD_VERSION = 1;

function resolveAuthSecret(env: CloudflareBindings | undefined): string {
	return env?.AUTH_SECRET ?? configEnv.AUTH_SECRET;
}

type HandoffError = {
	code:
		| "CONSENT_REQUIRED"
		| "SESSION_NOT_FOUND"
		| "SESSION_EXPIRED"
		| "SESSION_IN_PROGRESS";
	status: 404 | 409 | 410;
};

type HandoffSuccess = {
	v: number;
	session_id: string;
	mobile_write_token: string;
	expires_at: string;
	attest_hello_challenge: string;
	attest_nfc_challenge: string;
};

type SelectedHandoff =
	| { ok: false; error: HandoffError }
	| {
			ok: true;
			expiresAt: Date;
			issuedAt: Date;
			mobileWriteTokenSeed: string;
	  };

export type IssueHandoffResult =
	| { ok: false; error: HandoffError }
	| { ok: true; data: HandoffSuccess };

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
		return { ok: false, error: { code: "SESSION_NOT_FOUND", status: 404 } };
	}

	if (row.pendingDeletionAt) {
		return { ok: false, error: { code: "SESSION_NOT_FOUND", status: 404 } };
	}

	const session = row.session;
	const normalizedSession = await expireVerificationSessionIfNeeded({
		env,
		now,
		row: session,
	});

	if (
		isTerminalSessionStatus(normalizedSession.status) ||
		normalizedSession.expiresAt.getTime() < now.getTime()
	) {
		return { ok: false, error: { code: "SESSION_EXPIRED", status: 410 } };
	}

	const selected: SelectedHandoff = await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${session.id}::text, 1))`,
		);

		const [latestConsent] = await tx
			.select({ id: verification_consents.id })
			.from(verification_consents)
			.where(eq(verification_consents.verificationSessionId, session.id))
			.limit(1);

		if (!latestConsent) {
			return {
				ok: false,
				error: { code: "CONSENT_REQUIRED", status: 409 },
			};
		}

		const [current] = await tx
			.select({
				status: verification_sessions.status,
				mobileWriteTokenSeed: verification_sessions.mobileWriteTokenSeed,
				mobileWriteTokenHash: verification_sessions.mobileWriteTokenHash,
				mobileWriteTokenIssuedAt:
					verification_sessions.mobileWriteTokenIssuedAt,
				mobileWriteTokenExpiresAt:
					verification_sessions.mobileWriteTokenExpiresAt,
				mobileWriteTokenConsumedAt:
					verification_sessions.mobileWriteTokenConsumedAt,
			})
			.from(verification_sessions)
			.where(eq(verification_sessions.id, session.id))
			.limit(1);

		if (!current) {
			return {
				ok: false,
				error: { code: "SESSION_NOT_FOUND", status: 404 },
			};
		}

		if (
			current.status === "in_progress" &&
			current.mobileWriteTokenConsumedAt
		) {
			return {
				ok: false,
				error: { code: "SESSION_IN_PROGRESS", status: 409 },
			};
		}

		const canReuse = Boolean(
			current.mobileWriteTokenSeed &&
				current.mobileWriteTokenHash &&
				current.mobileWriteTokenIssuedAt &&
				current.mobileWriteTokenExpiresAt &&
				!current.mobileWriteTokenConsumedAt &&
				current.mobileWriteTokenExpiresAt.getTime() > now.getTime(),
		);

		if (
			canReuse &&
			current.mobileWriteTokenIssuedAt &&
			current.mobileWriteTokenExpiresAt &&
			current.mobileWriteTokenSeed
		) {
			return {
				ok: true,
				issuedAt: current.mobileWriteTokenIssuedAt,
				expiresAt: current.mobileWriteTokenExpiresAt,
				mobileWriteTokenSeed: current.mobileWriteTokenSeed,
			};
		}

		const issuedAt = now;
		const expiresAt = new Date(now.getTime() + HANDOFF_TOKEN_TTL_MS);
		const mobileWriteTokenSeed = generateMobileWriteTokenSeed();
		const token = await deriveMobileWriteToken({
			sessionId: session.id,
			issuedAt,
			seed: mobileWriteTokenSeed,
		});
		const tokenHash = await hashMobileWriteToken(token);

		await tx
			.update(verification_sessions)
			.set({
				mobileWriteTokenSeed,
				mobileWriteTokenHash: tokenHash,
				mobileWriteTokenIssuedAt: issuedAt,
				mobileWriteTokenExpiresAt: expiresAt,
				mobileWriteTokenConsumedAt: null,
			})
			.where(eq(verification_sessions.id, session.id));

		return {
			ok: true,
			issuedAt,
			expiresAt,
			mobileWriteTokenSeed,
		};
	});

	if (!selected.ok) {
		return selected;
	}

	const mobileWriteToken = await deriveMobileWriteToken({
		sessionId: session.id,
		issuedAt: selected.issuedAt,
		seed: selected.mobileWriteTokenSeed,
	});

	const authSecret = resolveAuthSecret(env);
	const [attestHelloChallenge, attestNfcChallenge] = await Promise.all([
		deriveAttestHelloChallenge({
			sessionId: session.id,
			authSecret,
		}),
		deriveAttestNfcChallenge({
			sessionId: session.id,
			authSecret,
		}),
	]);

	return {
		ok: true,
		data: {
			v: HANDOFF_PAYLOAD_VERSION,
			session_id: session.id,
			mobile_write_token: mobileWriteToken,
			expires_at: selected.expiresAt.toISOString(),
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
