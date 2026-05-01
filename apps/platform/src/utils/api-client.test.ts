import { afterEach, describe, expect, test, vi } from "vitest";
import { requestApiResource, requestApiResourcePage } from "./api-client";

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

describe("api client", () => {
	test("serializes query parameters and skips empty filter values", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: [],
				error: null,
				pagination: {
					has_more: false,
					limit: 20,
					next_cursor: null,
				},
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await requestApiResourcePage({
			basePath: "/api/example",
			path: "/items",
			query: {
				enabled: false,
				limit: 20,
				search: "",
				starting_after: null,
				status: "all",
			},
			unexpectedMessage: "Unexpected example response.",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/example/items?enabled=false&limit=20",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});

	test("throws envelope error messages from successful responses", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: null,
				error: {
					code: "BAD_RESPONSE",
					message: "Example request failed.",
				},
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(
			requestApiResource({
				basePath: "/api/example",
				unexpectedMessage: "Unexpected example response.",
			}),
		).rejects.toThrow("Example request failed.");
	});

	test("throws the unexpected message for malformed successful responses", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("not json", {
				status: 200,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(
			requestApiResource({
				basePath: "/api/example",
				unexpectedMessage: "Unexpected example response.",
			}),
		).rejects.toThrow("Unexpected example response.");
	});

	test("throws the unexpected message for success payloads without data", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				error: null,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(
			requestApiResource({
				basePath: "/api/example",
				unexpectedMessage: "Unexpected example response.",
			}),
		).rejects.toThrow("Unexpected example response.");
	});

	test("throws the unexpected message for malformed paginated payloads", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {},
				error: null,
				pagination: {
					has_more: false,
					limit: 20,
					next_cursor: null,
				},
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(
			requestApiResourcePage({
				basePath: "/api/example",
				unexpectedMessage: "Unexpected example page.",
			}),
		).rejects.toThrow("Unexpected example page.");
	});
});
