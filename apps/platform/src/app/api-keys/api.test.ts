import { afterEach, describe, expect, test, vi } from "vitest";
import { createApiKey, deleteApiKey, listApiKeys, updateApiKey } from "./api";

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

describe("api key api helpers", () => {
	test("lists API keys through the shared client", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: [
					{
						createdAt: "2026-03-19T00:00:00.000Z",
						enabled: true,
						id: "kk_123",
						metadata: {},
						name: "Primary",
						permissions: [],
						requestCount: 12,
						updatedAt: "2026-03-20T00:00:00.000Z",
					},
				],
				error: null,
				pagination: {
					has_more: false,
					limit: 10,
					next_cursor: null,
				},
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(listApiKeys()).resolves.toEqual({
			data: [
				{
					createdAt: "2026-03-19T00:00:00.000Z",
					enabled: true,
					id: "kk_123",
					metadata: {},
					name: "Primary",
					permissions: [],
					requestCount: 12,
					updatedAt: "2026-03-20T00:00:00.000Z",
				},
			],
			pagination: {
				has_more: false,
				limit: 10,
				next_cursor: null,
			},
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/api-keys",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});

	test("creates API keys with JSON request bodies", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					id: "kk_123",
					key: "kk_secret",
				},
				error: null,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(createApiKey({ name: "Primary" })).resolves.toEqual({
			id: "kk_123",
			key: "kk_secret",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/api-keys",
			expect.objectContaining({
				body: JSON.stringify({
					name: "Primary",
					permissions: ["sessions:write"],
				}),
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
	});

	test("forwards an explicit permissions list when provided", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: { id: "kk_124", key: "kk_secret2" },
				error: null,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await createApiKey({
			name: "Read-only",
			permissions: ["webhooks:read"],
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/api-keys",
			expect.objectContaining({
				body: JSON.stringify({
					name: "Read-only",
					permissions: ["webhooks:read"],
				}),
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
	});

	test("updates API keys through the shared client", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					message: "API key updated successfully",
					status: "success",
				},
				error: null,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await updateApiKey({ enabled: false, id: "kk_123" });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/api-keys/kk_123",
			expect.objectContaining({
				body: JSON.stringify({ enabled: false }),
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
	});

	test("deletes API keys through the shared client", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					message: "API key deleted successfully",
					status: "success",
				},
				error: null,
			}),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await deleteApiKey("kk_123");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/api-keys/kk_123",
			expect.objectContaining({
				credentials: "include",
				method: "DELETE",
			}),
		);
	});

	test("throws API error messages from failed responses", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse(
				{
					data: null,
					error: {
						code: "FORBIDDEN",
						message: "You are not authorized to list API keys",
					},
				},
				403,
			),
		);

		globalThis.fetch = fetchMock as typeof fetch;

		await expect(listApiKeys()).rejects.toThrow(
			"You are not authorized to list API keys",
		);
	});
});
