import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import {
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, eq } from "drizzle-orm";
import { createHMAC } from "@/functions/hmac";
import app from "@/index";
import v1 from "@/v1";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

type HandoffResponse = {
	data: {
		v: number;
		session_id: string;
		attempt_id: string;
		mobile_write_token: string;
		expires_at: string;
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

type VerifySessionStatusResponse = {
	data: {
		completed_at: string | null;
		is_terminal: boolean;
		latest_attempt: {
			completed_at: string | null;
			failure_code: string | null;
			handoff_claimed: boolean;
			id: string;
			retry_allowed: boolean;
			status: "cancelled" | "failed" | "in_progress" | "succeeded";
		} | null;
		redirect_url: string | null;
		session_id: string;
		same_device_only: boolean;
		status: "cancelled" | "completed" | "created" | "expired" | "in_progress";
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

type VerifySessionDetailsResponse = {
	data: {
		organization_name: string;
		organization_verified: boolean;
		session_id: string;
		is_age_only: boolean;
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

async function createSession({
	redirectUrl,
}: {
	redirectUrl?: string;
} = {}): Promise<string> {
	const { sessionId } = await createSessionWithCancelToken({ redirectUrl });
	return sessionId;
}

async function createSessionWithCancelToken({
	redirectUrl,
}: {
	redirectUrl?: string;
} = {}): Promise<{ sessionId: string; cancelToken: string }> {
	const response = await v1.request("/sessions", {
		body: redirectUrl
			? JSON.stringify({
					redirect_url: redirectUrl,
				})
			: undefined,
		headers: {
			Authorization: `Bearer ${TEST_DATA?.apiKey}`,
			...(redirectUrl ? { "Content-Type": "application/json" } : {}),
		},
		method: "POST",
	});

	if (response.status !== 200) {
		throw new Error(
			`Expected session creation to return 200, received ${response.status}`,
		);
	}

	const payload = (await response.json()) as {
		data: { id: string; cancel_token?: string };
	};

	if (!payload.data?.id) {
		throw new Error("Session creation response is missing data.id");
	}

	if (!payload.data.cancel_token) {
		throw new Error("Session creation response is missing data.cancel_token");
	}

	return {
		sessionId: payload.data.id,
		cancelToken: payload.data.cancel_token,
	};
}

describe("/v1/verify/session/:id/handoff", () => {
	test.serial("Returns 400 for invalid session ID", async () => {
		const response = await app.request(
			"/v1/verify/session/not-a-session/handoff",
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(400);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("INVALID_SESSION_ID");
	});

	test.serial("Returns 404 for unknown session", async () => {
		const unknownSessionId =
			"vs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

		const response = await app.request(
			`/v1/verify/session/${unknownSessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(404);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("SESSION_NOT_FOUND");
	});

	test.serial("Returns 410 for cancelled sessions", async () => {
		const sessionId = await createSession();

		const cancelResponse = await v1.request(`/sessions/${sessionId}/cancel`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
			},
		});
		expect(cancelResponse.status).toBe(204);

		const response = await app.request(
			`/v1/verify/session/${sessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(410);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("SESSION_EXPIRED");
	});

	test.serial("Returns 409 for in-progress sessions", async () => {
		const sessionId = await createSession();

		await db
			.update(verification_sessions)
			.set({ status: "in_progress" })
			.where(eq(verification_sessions.id, sessionId));

		const response = await app.request(
			`/v1/verify/session/${sessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(409);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("SESSION_IN_PROGRESS");
	});

	test.serial("Creates handoff payload and persists token hash", async () => {
		if (!TEST_DATA) {
			throw new Error("Test data not initialized");
		}

		const sessionId = await createSession();

		const response = await app.request(
			`/v1/verify/session/${sessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as HandoffResponse;

		expect(payload.error).toBeNull();
		expect(payload.data?.v).toBe(1);
		expect(payload.data?.session_id).toBe(sessionId);
		expect(payload.data?.attempt_id).toBeDefined();
		expect(payload.data?.mobile_write_token).toBeDefined();
		expect(payload.data?.expires_at).toBeDefined();

		const [attempt] = await db
			.select()
			.from(verification_attempts)
			.where(
				and(
					eq(verification_attempts.id, payload.data?.attempt_id ?? ""),
					eq(verification_attempts.verificationSessionId, sessionId),
				),
			)
			.limit(1);

		expect(attempt).toBeDefined();
		expect(attempt?.mobileWriteTokenSeed).toBeDefined();
		expect(attempt?.mobileWriteTokenSeed).not.toBe(
			payload.data?.mobile_write_token,
		);
		expect(attempt?.mobileWriteTokenHash).toBeDefined();
		expect(attempt?.mobileWriteTokenHash).not.toBe(
			payload.data?.mobile_write_token,
		);
		expect(attempt?.mobileWriteTokenIssuedAt).not.toBeNull();
		expect(attempt?.mobileWriteTokenExpiresAt).not.toBeNull();

		const expectedHash = await createHMAC(
			payload.data?.mobile_write_token ?? "",
			{
				secret: env.AUTH_SECRET,
			},
		);
		expect(attempt?.mobileWriteTokenHash).toBe(expectedHash);
	});

	test.serial(
		"Reuses attempt and expiry within the 60-second idempotency window",
		async () => {
			const sessionId = await createSession();

			const firstResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(firstResponse.status).toBe(200);
			const firstPayload = (await firstResponse.json()) as HandoffResponse;

			const secondResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(secondResponse.status).toBe(200);
			const secondPayload = (await secondResponse.json()) as HandoffResponse;

			expect(secondPayload.data?.attempt_id).toBe(
				firstPayload.data?.attempt_id,
			);
			expect(secondPayload.data?.expires_at).toBe(
				firstPayload.data?.expires_at,
			);
			expect(secondPayload.data?.mobile_write_token).toBe(
				firstPayload.data?.mobile_write_token,
			);
		},
	);

	test.serial(
		"Issues a new attempt after the idempotency window elapses",
		async () => {
			const sessionId = await createSession();

			const firstResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(firstResponse.status).toBe(200);
			const firstPayload = (await firstResponse.json()) as HandoffResponse;
			const firstAttemptId = firstPayload.data?.attempt_id;

			await db
				.update(verification_attempts)
				.set({
					mobileWriteTokenIssuedAt: new Date(Date.now() - 61_000),
				})
				.where(eq(verification_attempts.id, firstAttemptId ?? ""));

			const secondResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(secondResponse.status).toBe(200);
			const secondPayload = (await secondResponse.json()) as HandoffResponse;

			expect(secondPayload.data?.attempt_id).not.toBe(firstAttemptId);
		},
	);
});

describe("/v1/verify/session/:id/status", () => {
	test.serial(
		"Returns 400 for invalid session ID details requests",
		async () => {
			const response = await app.request(
				"/v1/verify/session/not-a-session/details",
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(400);
			const payload = (await response.json()) as VerifySessionDetailsResponse;
			expect(payload.error?.code).toBe("INVALID_SESSION_ID");
		},
	);

	test.serial(
		"Returns the public session details with organization name",
		async () => {
			const sessionId = await createSession();

			const response = await app.request(
				`/v1/verify/session/${sessionId}/details`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionDetailsResponse;

			expect(payload.error).toBeNull();
			expect(payload.data).toEqual({
				organization_name: "Test Organization",
				organization_verified: true,
				session_id: sessionId,
				is_age_only: false,
			});
		},
	);

	test.serial(
		"Cancels a live verification session via the public verify route",
		async () => {
			const { sessionId, cancelToken } = await createSessionWithCancelToken();

			const response = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(204);

			const [session] = await db
				.select({
					status: verification_sessions.status,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			expect(session?.status).toBe("cancelled");
		},
	);

	test.serial("Rejects public cancel without a cancel_token", async () => {
		const { sessionId } = await createSessionWithCancelToken();

		const response = await app.request(
			`/v1/verify/session/${sessionId}/cancel`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(400);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("INVALID_REQUEST");
	});

	test.serial("Rejects public cancel with the wrong cancel_token", async () => {
		const { sessionId } = await createSessionWithCancelToken();

		const response = await app.request(
			`/v1/verify/session/${sessionId}/cancel`,
			{
				body: JSON.stringify({ cancel_token: "ct_wrong_value" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			},
		);

		expect(response.status).toBe(401);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("CANCEL_TOKEN_INVALID");
	});

	test.serial(
		"Rejects public cancel with a token bound to a different session",
		async () => {
			const { sessionId: targetSessionId } =
				await createSessionWithCancelToken();
			const { cancelToken: foreignToken } =
				await createSessionWithCancelToken();

			const response = await app.request(
				`/v1/verify/session/${targetSessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: foreignToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(401);
			const payload = (await response.json()) as VerifySessionStatusResponse;
			expect(payload.error?.code).toBe("CANCEL_TOKEN_INVALID");
		},
	);

	test.serial(
		"Public cancel is idempotent on the same token after a successful cancel",
		async () => {
			const { sessionId, cancelToken } = await createSessionWithCancelToken();

			const firstResponse = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);
			expect(firstResponse.status).toBe(204);

			const secondResponse = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);
			expect(secondResponse.status).toBe(204);
		},
	);

	test.serial(
		"Returns 404 when cancelling an unknown verification session",
		async () => {
			const response = await app.request(
				"/v1/verify/session/vs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/cancel",
				{
					body: JSON.stringify({ cancel_token: "ct_anything" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(404);
			const payload = (await response.json()) as VerifySessionStatusResponse;
			expect(payload.error?.code).toBe("SESSION_NOT_FOUND");
		},
	);

	test.serial("Returns 400 for invalid session ID", async () => {
		const response = await app.request(
			"/v1/verify/session/not-a-session/status",
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(400);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("INVALID_SESSION_ID");
	});

	test.serial("Returns 404 for unknown session", async () => {
		const response = await app.request(
			"/v1/verify/session/vs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/status",
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(404);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("SESSION_NOT_FOUND");
	});

	test.serial(
		"Returns the terminal session payload with redirect URL and latest attempt",
		async () => {
			const completedAt = new Date("2099-01-01T00:00:00.000Z");
			const sessionId = await createSession({
				redirectUrl: "https://example.com/return",
			});

			await db
				.update(verification_sessions)
				.set({
					status: "completed",
					completedAt,
				})
				.where(eq(verification_sessions.id, sessionId));

			await db.insert(verification_attempts).values({
				id: "va_status_completed",
				verificationSessionId: sessionId,
				status: "succeeded",
				completedAt,
				mobileWriteTokenConsumedAt: completedAt,
				mobileHelloDeviceIdHash: "device_hash",
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/status`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionStatusResponse;

			expect(payload.error).toBeNull();
			expect(payload.data).toEqual({
				completed_at: completedAt.toISOString(),
				is_terminal: true,
				latest_attempt: {
					completed_at: completedAt.toISOString(),
					failure_code: null,
					handoff_claimed: true,
					id: "va_status_completed",
					retry_allowed: false,
					status: "succeeded",
				},
				redirect_url: "https://example.com/return",
				session_id: sessionId,
				same_device_only: true,
				status: "completed",
			});
		},
	);

	test.serial(
		"Exposes same-device retry state after a failed claimed attempt",
		async () => {
			const completedAt = new Date("2099-01-01T00:00:00.000Z");
			const sessionId = await createSession();

			await db.insert(verification_attempts).values({
				id: "va_status_retryable_failed",
				verificationSessionId: sessionId,
				status: "failed",
				failureCode: "selfie_face_mismatch",
				completedAt,
				mobileWriteTokenConsumedAt: completedAt,
				mobileHelloDeviceIdHash: "device_hash",
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/status`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionStatusResponse;

			expect(payload.error).toBeNull();
			expect(payload.data).toEqual({
				completed_at: null,
				is_terminal: false,
				latest_attempt: {
					completed_at: completedAt.toISOString(),
					failure_code: "selfie_face_mismatch",
					handoff_claimed: true,
					id: "va_status_retryable_failed",
					retry_allowed: true,
					status: "failed",
				},
				redirect_url: null,
				session_id: sessionId,
				same_device_only: true,
				status: "created",
			});
		},
	);

	test.serial(
		"Lazily normalizes expired sessions and updates the latest in-progress attempt",
		async () => {
			const expiredAt = new Date(Date.now() - 60_000);
			const sessionId = await createSession();

			await db
				.update(verification_sessions)
				.set({
					expiresAt: expiredAt,
				})
				.where(eq(verification_sessions.id, sessionId));

			await db.insert(verification_attempts).values({
				id: "va_status_expired",
				verificationSessionId: sessionId,
				status: "in_progress",
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/status`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionStatusResponse;

			expect(payload.error).toBeNull();
			expect(payload.data?.session_id).toBe(sessionId);
			expect(payload.data?.status).toBe("expired");
			expect(payload.data?.is_terminal).toBeTrue();
			expect(payload.data?.same_device_only).toBeFalse();
			expect(payload.data?.latest_attempt?.id).toBe("va_status_expired");
			expect(payload.data?.latest_attempt?.status).toBe("failed");
			expect(payload.data?.latest_attempt?.failure_code).toBe(
				"session_expired",
			);
			expect(payload.data?.latest_attempt?.handoff_claimed).toBeFalse();
			expect(payload.data?.latest_attempt?.retry_allowed).toBeFalse();

			const [session] = await db
				.select({
					completedAt: verification_sessions.completedAt,
					status: verification_sessions.status,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			const [attempt] = await db
				.select({
					completedAt: verification_attempts.completedAt,
					failureCode: verification_attempts.failureCode,
					status: verification_attempts.status,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, "va_status_expired"))
				.limit(1);

			expect(session?.status).toBe("expired");
			expect(session?.completedAt).not.toBeNull();
			expect(attempt?.status).toBe("failed");
			expect(attempt?.failureCode).toBe("session_expired");
			expect(attempt?.completedAt).not.toBeNull();
		},
	);
});
