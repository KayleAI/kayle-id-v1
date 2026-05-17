import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import {
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { issueHandoffPayload } from "@/v1/verify/handoff";
import { getPublicVerifySessionDetails } from "@/v1/verify/session-details";
import { getPublicVerifySessionStatus } from "@/v1/verify/session-status";
import {
	generateSessionCancelToken,
	hashSessionCancelToken,
} from "@/v1/verify/token-crypto";
import { setup, type TestData, teardown } from "../setup";

mock.module("cloudflare:workers", () => ({
	WorkflowEntrypoint: class {
		ctx: unknown;
		env: unknown;

		constructor(ctx?: unknown, env?: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

let TEST_DATA: TestData | undefined;
const createdSessionIds: string[] = [];

async function createVisibleSession(): Promise<{
	cancelToken: string;
	sessionId: string;
}> {
	if (!TEST_DATA) {
		throw new Error("Test data not initialized");
	}

	const sessionId = generateId({ type: "vs" });
	const cancelToken = generateSessionCancelToken();

	await db.insert(verification_sessions).values({
		cancelTokenHash: await hashSessionCancelToken(cancelToken),
		id: sessionId,
		organizationId: TEST_DATA.organizationId,
		redirectUrl: "https://example.com/return",
	});

	createdSessionIds.push(sessionId);
	return { cancelToken, sessionId };
}

async function setOrganizationPendingDeletion(
	pendingDeletionAt: Date | null,
): Promise<void> {
	if (!TEST_DATA) {
		throw new Error("Test data not initialized");
	}

	await db
		.update(auth_organizations)
		.set({ pending_deletion_at: pendingDeletionAt })
		.where(eq(auth_organizations.id, TEST_DATA.organizationId));
}

async function setOrganizationMetadata(
	metadata: Record<string, unknown> | null,
): Promise<void> {
	if (!TEST_DATA) {
		throw new Error("Test data not initialized");
	}

	await db
		.update(auth_organizations)
		.set({ metadata: metadata ? JSON.stringify(metadata) : null })
		.where(eq(auth_organizations.id, TEST_DATA.organizationId));
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(async () => {
	await setOrganizationPendingDeletion(null);
	await setOrganizationMetadata(null);

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

test("public verify session details expose RP fallback contact fields", async () => {
	const { sessionId } = await createVisibleSession();
	await setOrganizationMetadata({
		appealUrl: "https://rp.example/review",
		complaintsUrl: "https://rp.example/complaints",
		fallbackIdvUrl: "https://rp.example/manual-idv",
		supportEmail: "support@rp.example",
	});

	const details = await getPublicVerifySessionDetails({ sessionId });

	expect(details?.rp_fallback).toEqual({
		appeal_url: "https://rp.example/review",
		complaints_url: "https://rp.example/complaints",
		fallback_idv_url: "https://rp.example/manual-idv",
		support_email: "support@rp.example",
	});
});

test("public verify session surfaces hide sessions owned by organizations pending deletion", async () => {
	const { cancelToken, sessionId } = await createVisibleSession();
	await setOrganizationPendingDeletion(new Date());

	const handoff = await issueHandoffPayload(sessionId);
	expect(handoff).toEqual({
		ok: false,
		error: {
			code: "SESSION_NOT_FOUND",
			status: 404,
		},
	});

	await expect(
		getPublicVerifySessionDetails({ sessionId }),
	).resolves.toBeNull();
	await expect(getPublicVerifySessionStatus({ sessionId })).resolves.toBeNull();

	const { default: app } = await import("@/index");
	const cancelResponse = await app.request(
		`/v1/verify/session/${sessionId}/cancel`,
		{
			body: JSON.stringify({ cancel_token: cancelToken }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		},
	);

	expect(cancelResponse.status).toBe(404);
	const cancelPayload = (await cancelResponse.json()) as {
		error?: { code?: string };
	};
	expect(cancelPayload.error?.code).toBe("SESSION_NOT_FOUND");

	const attempts = await db
		.select({ id: verification_attempts.id })
		.from(verification_attempts)
		.where(eq(verification_attempts.verificationSessionId, sessionId));
	expect(attempts).toHaveLength(0);

	const [session] = await db
		.select({
			cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
			status: verification_sessions.status,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);
	expect(session?.status).toBe("created");
	expect(session?.cancelTokenConsumedAt).toBeNull();
});
