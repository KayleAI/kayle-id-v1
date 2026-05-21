import { afterEach, describe, expect, test, vi } from "vitest";
import {
	requestCancelVerifySession,
	requestHandoffPayload,
	requestVerifySessionStatus,
} from "./verify-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

function mockFetchResponse(response: Response): void {
	globalThis.fetch = vi.fn(async () => response);
}

describe("verify handoff requests", () => {
	test("returns handoff payload data from a valid API envelope", async () => {
		mockFetchResponse(
			Response.json({
				data: {
					attempt_id: "va_test",
					expires_at: "2026-05-01T00:00:00.000Z",
					mobile_write_token: "token",
					session_id: "vs_test",
					v: 1,
				},
				error: null,
			}),
		);

		await expect(requestHandoffPayload("vs_test")).resolves.toEqual({
			attempt_id: "va_test",
			expires_at: "2026-05-01T00:00:00.000Z",
			mobile_write_token: "token",
			session_id: "vs_test",
			v: 1,
		});
	});

	test("throws a stable error for malformed session status JSON", async () => {
		mockFetchResponse(
			new Response("not-json", {
				status: 200,
			}),
		);

		await expect(requestVerifySessionStatus("vs_test")).rejects.toMatchObject({
			code: "UNKNOWN",
			message: "Failed to fetch verification session status.",
		});
	});

	test("throws a stable error for malformed envelopes", async () => {
		mockFetchResponse(Response.json(["unexpected"], { status: 200 }));

		await expect(requestHandoffPayload("vs_test")).rejects.toMatchObject({
			code: "UNKNOWN",
			message: "Failed to fetch handoff credentials.",
		});
	});

	test("uses structured API errors when cancel fails", async () => {
		mockFetchResponse(
			Response.json(
				{
					data: null,
					error: {
						code: "SESSION_TERMINAL",
						message: "Session is already complete.",
					},
				},
				{ status: 409 },
			),
		);

		await expect(
			requestCancelVerifySession("vs_test", "ct_token"),
		).rejects.toMatchObject({
			code: "SESSION_TERMINAL",
			message: "Session is already complete.",
		});
	});
});
