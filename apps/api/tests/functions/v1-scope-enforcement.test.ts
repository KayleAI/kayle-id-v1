import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApiKey } from "@/functions/auth/create-api-key";
import app from "@/index";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

function requireOrganizationId(): string {
	if (!TEST_DATA?.organizationId) {
		throw new Error("Test organization is not initialized.");
	}

	return TEST_DATA.organizationId;
}

describe("v1 API-key scope enforcement", () => {
	test("denies no-scope keys on collection-root routes", async () => {
		const { apiKey } = await createApiKey({
			name: "No-scope collection key",
			organizationId: requireOrganizationId(),
			permissions: [],
		});

		const requests = [
			app.request("/v1/sessions", {
				headers: { Authorization: `Bearer ${apiKey}` },
				method: "GET",
			}),
			app.request("/v1/sessions", {
				headers: { Authorization: `Bearer ${apiKey}` },
				method: "POST",
			}),
			app.request("/v1/events?limit=1", {
				headers: { Authorization: `Bearer ${apiKey}` },
				method: "GET",
			}),
		];

		const responses = await Promise.all(requests);

		for (const response of responses) {
			expect(response.status).toBe(403);
		}
	});

	test("denies read-only session keys on collection-root writes", async () => {
		const { apiKey } = await createApiKey({
			name: "Read-only collection key",
			organizationId: requireOrganizationId(),
			permissions: ["sessions:read"],
		});

		const response = await app.request("/v1/sessions", {
			headers: { Authorization: `Bearer ${apiKey}` },
			method: "POST",
		});

		expect(response.status).toBe(403);
	});
});
