import { afterEach, describe, expect, test, vi } from "vitest";
import {
	createDemoRun,
	createDemoVerificationSession,
	getDemoRun,
} from "./demo-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

function mockJsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		headers: {
			"Content-Type": "application/json",
		},
		status,
	});
}

describe("demo api helpers", () => {
	test("creates demo runs through the shared API client", async () => {
		const publicJwk = { e: "AQAB", kty: "RSA", n: "modulus" };
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					demo_run_id: "demo_123",
					endpoint_id: "whe_demo_123",
					org_slug: "demo",
					signing_secret: "whsec_demo_123",
				},
				error: null,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(createDemoRun({ publicJwk })).resolves.toEqual({
			demo_run_id: "demo_123",
			endpoint_id: "whe_demo_123",
			org_slug: "demo",
			signing_secret: "whsec_demo_123",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/demo/runs",
			expect.objectContaining({
				body: JSON.stringify({ public_jwk: publicJwk }),
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
	});

	test("creates demo sessions with selected share fields", async () => {
		const shareFields = {
			age_over_18: {
				reason: "Age check",
				required: true,
			},
		};
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					session_id: "vs_demo_123",
					share_fields: {
						age_over_18: {
							reason: "Age check",
							required: true,
							source: "rc",
						},
					},
					verification_url: "https://verify.kayle.id/session/vs_demo_123",
				},
				error: null,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await createDemoVerificationSession({
			runId: "demo_123",
			shareFields,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/demo/runs/demo_123/session",
			expect.objectContaining({
				body: JSON.stringify({ share_fields: shareFields }),
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
	});

	test("loads demo runs and propagates API error messages", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse(
				{
					data: null,
					error: {
						code: "NOT_FOUND",
						message: "Demo run not found.",
					},
				},
				404,
			),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(getDemoRun("demo_missing")).rejects.toThrow(
			"Demo run not found.",
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/demo/runs/demo_missing",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});
});
