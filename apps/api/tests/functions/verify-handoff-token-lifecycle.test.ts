import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { issueHandoffPayload } from "@/v1/verify/handoff";
import {
	generateSessionCancelToken,
	hashSessionCancelToken,
} from "@/v1/verify/token-crypto";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;
const createdSessionIds: string[] = [];

async function createSession(): Promise<string> {
	if (!TEST_DATA) {
		throw new Error("Test data not initialized");
	}

	const sessionId = generateId({ type: "vs" });
	const cancelToken = generateSessionCancelToken();

	await db.insert(verification_sessions).values({
		cancelTokenHash: await hashSessionCancelToken(cancelToken),
		id: sessionId,
		organizationId: TEST_DATA.organizationId,
	});

	createdSessionIds.push(sessionId);
	return sessionId;
}

async function countAttempts(sessionId: string): Promise<number> {
	const rows = await db
		.select({ id: verification_attempts.id })
		.from(verification_attempts)
		.where(eq(verification_attempts.verificationSessionId, sessionId));

	return rows.length;
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(async () => {
	for (const sessionId of createdSessionIds) {
		await db
			.delete(verification_sessions)
			.where(eq(verification_sessions.id, sessionId));
	}
	createdSessionIds.length = 0;
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

test("reuses an unclaimed handoff token for its full token lifetime", async () => {
	const sessionId = await createSession();
	const now = new Date("2026-01-01T00:00:00.000Z");

	const first = await issueHandoffPayload(sessionId, { now });
	expect(first.ok).toBe(true);
	if (!first.ok) {
		throw new Error(`Expected first handoff, received ${first.error.code}`);
	}

	const second = await issueHandoffPayload(sessionId, {
		now: new Date(now.getTime() + 61_000),
	});
	expect(second.ok).toBe(true);
	if (!second.ok) {
		throw new Error(`Expected reused handoff, received ${second.error.code}`);
	}

	expect(second.data.attempt_id).toBe(first.data.attempt_id);
	expect(second.data.mobile_write_token).toBe(first.data.mobile_write_token);
	expect(second.data.expires_at).toBe(first.data.expires_at);
	await expect(countAttempts(sessionId)).resolves.toBe(1);
});

test("serializes concurrent handoff issuance for one active token", async () => {
	const sessionId = await createSession();
	const now = new Date("2026-01-01T00:00:00.000Z");
	const requests = Array.from({ length: 8 }, () =>
		issueHandoffPayload(sessionId, { now }),
	);

	const responses = await Promise.all(requests);
	const attemptIds = new Set<string>();
	const mobileWriteTokens = new Set<string>();

	for (const response of responses) {
		expect(response.ok).toBe(true);
		if (!response.ok) {
			throw new Error(`Expected handoff, received ${response.error.code}`);
		}
		attemptIds.add(response.data.attempt_id);
		mobileWriteTokens.add(response.data.mobile_write_token);
	}

	expect(attemptIds.size).toBe(1);
	expect(mobileWriteTokens.size).toBe(1);
	await expect(countAttempts(sessionId)).resolves.toBe(1);
});

test("issues a new handoff only after the active token expires", async () => {
	const sessionId = await createSession();
	const now = new Date("2026-01-01T00:00:00.000Z");

	const first = await issueHandoffPayload(sessionId, { now });
	expect(first.ok).toBe(true);
	if (!first.ok) {
		throw new Error(`Expected first handoff, received ${first.error.code}`);
	}

	const second = await issueHandoffPayload(sessionId, {
		now: new Date(now.getTime() + 5 * 60_000 + 1),
	});
	expect(second.ok).toBe(true);
	if (!second.ok) {
		throw new Error(
			`Expected refreshed handoff, received ${second.error.code}`,
		);
	}

	expect(second.data.attempt_id).not.toBe(first.data.attempt_id);
	expect(second.data.mobile_write_token).not.toBe(
		first.data.mobile_write_token,
	);
	await expect(countAttempts(sessionId)).resolves.toBe(2);
});

test("blocks new handoff issuance after the token is claimed", async () => {
	const sessionId = await createSession();
	const now = new Date("2026-01-01T00:00:00.000Z");

	const first = await issueHandoffPayload(sessionId, { now });
	expect(first.ok).toBe(true);
	if (!first.ok) {
		throw new Error(`Expected first handoff, received ${first.error.code}`);
	}

	await db
		.update(verification_attempts)
		.set({ mobileWriteTokenConsumedAt: new Date() })
		.where(eq(verification_attempts.id, first.data.attempt_id));

	const second = await issueHandoffPayload(sessionId, {
		now: new Date(now.getTime() + 1_000),
	});

	expect(second).toEqual({
		ok: false,
		error: {
			code: "SESSION_IN_PROGRESS",
			status: 409,
		},
	});
	await expect(countAttempts(sessionId)).resolves.toBe(1);
});
