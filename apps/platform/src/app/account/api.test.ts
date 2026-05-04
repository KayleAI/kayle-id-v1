import { afterEach, describe, expect, test, vi } from "vitest";
import { listOwnedOrganizations } from "./api";

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

describe("listOwnedOrganizations", () => {
	test("hits /api/auth/account/owned-organizations and unwraps the organizations array", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					organizations: [
						{ id: "org-1", name: "First", slug: "first" },
						{ id: "org-2", name: "Second", slug: "second" },
					],
				},
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const result = await listOwnedOrganizations();

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/account/owned-organizations",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
		expect(result).toEqual([
			{ id: "org-1", name: "First", slug: "first" },
			{ id: "org-2", name: "Second", slug: "second" },
		]);
	});

	test("propagates envelope error messages from the API", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to load owned organizations.",
				},
			}),
		) as typeof fetch;

		await expect(listOwnedOrganizations()).rejects.toThrow(
			"Failed to load owned organizations.",
		);
	});
});
