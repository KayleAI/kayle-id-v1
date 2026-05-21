import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import { webhook_endpoints } from "@kayle-id/database/schema/webhooks";
import { eq } from "drizzle-orm";
import { createApiKey } from "@/functions/auth/create-api-key";
import app from "@/index";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;
const UPDATED_WEBHOOK_EVENT_TYPES = [
	"verification.session.failed",
	"verification.session.expired",
] as const;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

describe("/v1/webhooks/endpoints", () => {
	test("rejects oversized endpoint IDs before lookup", async () => {
		const response = await app.request(
			`/v1/webhooks/endpoints/whe_${"a".repeat(200)}`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
			},
		);

		expect(response.status).toBe(400);
	});

	test("creates an endpoint, returns the signing secret once, and persists subscriptions", async () => {
		const response = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				labels: ["production", "identity"],
				name: "Primary verification webhook",
				subscribed_event_types: [...SUPPORTED_WEBHOOK_EVENT_TYPES],
				url: "https://example.com/webhooks/kayle",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});

		expect(response.status).toBe(200);

		const payload = (await response.json()) as {
			data: {
				endpoint: {
					id: string;
					labels: string[];
					name: string | null;
					subscribed_event_types: string[];
					undelivered_payload_retention_hours: number;
				};
				signing_secret: string;
			};
			error: null;
		};

		expect(payload.error).toBeNull();
		expect(payload.data.endpoint.name).toBe("Primary verification webhook");
		expect(payload.data.endpoint.labels).toEqual(["production", "identity"]);
		expect(payload.data.endpoint.subscribed_event_types).toEqual([
			...SUPPORTED_WEBHOOK_EVENT_TYPES,
		]);
		expect(payload.data.endpoint.undelivered_payload_retention_hours).toBe(72);
		expect(payload.data.signing_secret.startsWith("whsec_")).toBeTrue();
		expect(payload.data.signing_secret).toHaveLength(38);

		const getResponse = await app.request(
			`/v1/webhooks/endpoints/${payload.data.endpoint.id}`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
			},
		);

		expect(getResponse.status).toBe(200);

		const getPayload = (await getResponse.json()) as {
			data: {
				id: string;
				labels: string[];
				name: string | null;
				signing_secret?: string;
				subscribed_event_types: string[];
				undelivered_payload_retention_hours: number;
			};
			error: null;
		};

		expect(getPayload.data.id).toBe(payload.data.endpoint.id);
		expect(getPayload.data.name).toBe("Primary verification webhook");
		expect(getPayload.data.labels).toEqual(["production", "identity"]);
		expect(getPayload.data.subscribed_event_types).toEqual([
			...SUPPORTED_WEBHOOK_EVENT_TYPES,
		]);
		expect(getPayload.data.undelivered_payload_retention_hours).toBe(72);
		expect("signing_secret" in getPayload.data).toBeFalse();
	});

	test("rejects invalid endpoint labels", async () => {
		for (const labels of [
			["demo", " DEMO "],
			["valid", ""],
			Array.from({ length: 9 }, (_, index) => `label-${index}`),
			["a".repeat(41)],
		]) {
			const response = await app.request("/v1/webhooks/endpoints", {
				body: JSON.stringify({
					labels,
					url: "https://example.com/webhooks/kayle/invalid-labels",
				}),
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				method: "POST",
			});

			expect(response.status).toBe(400);
		}
	});

	test("rotates the signing secret for an endpoint", async () => {
		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				url: "https://example.com/webhooks/kayle/rotate",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		const createdPayload = (await createResponse.json()) as {
			data: {
				endpoint: {
					id: string;
				};
				signing_secret: string;
			};
			error: null;
		};

		const rotateResponse = await app.request(
			`/v1/webhooks/endpoints/${createdPayload.data.endpoint.id}/signing-secret/rotate`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "POST",
			},
		);

		expect(rotateResponse.status).toBe(200);

		const rotatePayload = (await rotateResponse.json()) as {
			data: {
				endpoint_id: string;
				signing_secret: string;
			};
			error: null;
		};

		expect(rotatePayload.data.endpoint_id).toBe(
			createdPayload.data.endpoint.id,
		);
		expect(rotatePayload.data.signing_secret).not.toBe(
			createdPayload.data.signing_secret,
		);
		expect(rotatePayload.data.signing_secret).toHaveLength(38);
	});

	test("reveals the current signing secret for an endpoint", async () => {
		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				url: "https://example.com/webhooks/kayle/reveal",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		const createdPayload = (await createResponse.json()) as {
			data: {
				endpoint: {
					id: string;
				};
				signing_secret: string;
			};
			error: null;
		};

		const revealResponse = await app.request(
			`/v1/webhooks/endpoints/${createdPayload.data.endpoint.id}/signing-secret/reveal`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "POST",
			},
		);

		expect(revealResponse.status).toBe(200);

		const revealPayload = (await revealResponse.json()) as {
			data: {
				endpoint_id: string;
				signing_secret: string;
			};
			error: null;
		};

		expect(revealPayload.error).toBeNull();
		expect(revealPayload.data.endpoint_id).toBe(
			createdPayload.data.endpoint.id,
		);
		expect(revealPayload.data.signing_secret).toBe(
			createdPayload.data.signing_secret,
		);
		expect(revealPayload.data.signing_secret).toHaveLength(38);
	});

	test("returns 500 when the signing secret cannot be decrypted", async () => {
		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				url: "https://example.com/webhooks/kayle/broken-secret",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		const createdPayload = (await createResponse.json()) as {
			data: {
				endpoint: {
					id: string;
				};
			};
			error: null;
		};

		await db
			.update(webhook_endpoints)
			.set({
				signingSecretCiphertext: "not-a-valid-ciphertext",
			})
			.where(eq(webhook_endpoints.id, createdPayload.data.endpoint.id));

		const revealResponse = await app.request(
			`/v1/webhooks/endpoints/${createdPayload.data.endpoint.id}/signing-secret/reveal`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "POST",
			},
		);

		expect(revealResponse.status).toBe(500);
	});

	test("updates endpoint name, url, enabled state, and subscriptions", async () => {
		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				labels: ["before"],
				name: "Before rename",
				subscribed_event_types: [...SUPPORTED_WEBHOOK_EVENT_TYPES],
				url: "https://example.com/webhooks/kayle/update-before",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		const createdPayload = (await createResponse.json()) as {
			data: {
				endpoint: {
					id: string;
				};
			};
			error: null;
		};

		const updateResponse = await app.request(
			`/v1/webhooks/endpoints/${createdPayload.data.endpoint.id}`,
			{
				body: JSON.stringify({
					name: "After rename",
					labels: ["after", "ops"],
					url: "https://example.com/webhooks/kayle/update-after",
					enabled: false,
					subscribed_event_types: UPDATED_WEBHOOK_EVENT_TYPES,
					undelivered_payload_retention_hours: 24,
				}),
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				method: "PATCH",
			},
		);

		expect(updateResponse.status).toBe(200);

		const updatePayload = (await updateResponse.json()) as {
			data: {
				disabled_at: string | null;
				enabled: boolean;
				labels: string[];
				name: string | null;
				subscribed_event_types: string[];
				undelivered_payload_retention_hours: number;
				url: string;
			};
			error: null;
		};

		expect(updatePayload.error).toBeNull();
		expect(updatePayload.data.name).toBe("After rename");
		expect(updatePayload.data.labels).toEqual(["after", "ops"]);
		expect(updatePayload.data.url).toBe(
			"https://example.com/webhooks/kayle/update-after",
		);
		expect(updatePayload.data.enabled).toBeFalse();
		expect(updatePayload.data.disabled_at).toBeString();
		expect(updatePayload.data.subscribed_event_types).toEqual([
			...UPDATED_WEBHOOK_EVENT_TYPES,
		]);
		expect(updatePayload.data.undelivered_payload_retention_hours).toBe(24);

		const listResponse = await app.request(
			"/v1/webhooks/endpoints?enabled=false&limit=10",
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "GET",
			},
		);

		expect(listResponse.status).toBe(200);

		const listPayload = (await listResponse.json()) as {
			data: Array<{
				enabled: boolean;
				id: string;
			}>;
			error: null;
			pagination: {
				has_more: boolean;
				limit: number;
				next_cursor: string | null;
			};
		};

		expect(listPayload.error).toBeNull();
		expect(
			listPayload.data.some(
				(endpoint) =>
					endpoint.id === createdPayload.data.endpoint.id &&
					endpoint.enabled === false,
			),
		).toBeTrue();
	});

	test("deletes an endpoint and returns not found afterwards", async () => {
		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				url: "https://example.com/webhooks/kayle/delete-me",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		const createdPayload = (await createResponse.json()) as {
			data: {
				endpoint: {
					id: string;
				};
			};
			error: null;
		};

		const deleteResponse = await app.request(
			`/v1/webhooks/endpoints/${createdPayload.data.endpoint.id}`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "DELETE",
			},
		);

		expect(deleteResponse.status).toBe(200);

		const deletePayload = (await deleteResponse.json()) as {
			data: {
				message: string;
				status: "success";
			};
			error: null;
		};

		expect(deletePayload.error).toBeNull();
		expect(deletePayload.data.status).toBe("success");

		const [deletedRow] = await db
			.select()
			.from(webhook_endpoints)
			.where(eq(webhook_endpoints.id, createdPayload.data.endpoint.id))
			.limit(1);

		expect(deletedRow).toBeUndefined();

		const getResponse = await app.request(
			`/v1/webhooks/endpoints/${createdPayload.data.endpoint.id}`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
			},
		);

		expect(getResponse.status).toBe(404);
	});

	test("lists endpoints newest first without dropping tied timestamps", async () => {
		const createdAt = new Date("9999-01-01T00:00:00.000Z");
		const endpointIds = Array.from({ length: 4 }, () =>
			generateEndpointTestId(),
		);

		await db.insert(webhook_endpoints).values(
			endpointIds.map((endpointId, index) => ({
				id: endpointId,
				organizationId: TEST_DATA?.organizationId ?? "",
				createdAt,
				url: `https://example.com/webhooks/page-${index}`,
			})),
		);

		const firstPage = await app.request("/v1/webhooks/endpoints?limit=2", {
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
			},
			method: "GET",
		});
		expect(firstPage.status).toBe(200);
		const firstPayload = (await firstPage.json()) as {
			data: Array<{ id: string }>;
			pagination: { has_more: boolean; next_cursor: string | null };
		};
		expect(firstPayload.pagination.has_more).toBeTrue();
		expect(firstPayload.pagination.next_cursor).toBeString();

		const secondPage = await app.request(
			`/v1/webhooks/endpoints?limit=2&starting_after=${firstPayload.pagination.next_cursor}`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "GET",
			},
		);
		expect(secondPage.status).toBe(200);
		const secondPayload = (await secondPage.json()) as {
			data: Array<{ id: string }>;
		};
		const pagedIds = [
			...firstPayload.data.map((endpoint) => endpoint.id),
			...secondPayload.data.map((endpoint) => endpoint.id),
		];
		const seen = new Set(pagedIds);

		expect(pagedIds).toEqual([...endpointIds].sort().reverse());
		for (const endpointId of endpointIds) {
			expect(seen.has(endpointId)).toBeTrue();
		}
		expect(seen.size).toBe(
			firstPayload.data.length + secondPayload.data.length,
		);
	});
});

function generateEndpointTestId(): string {
	return `whe_${crypto.randomUUID()}`;
}

describe("/v1/webhooks/endpoints API-key scope enforcement", () => {
	test("denies a key with no scopes on every webhooks route", async () => {
		const organizationId = TEST_DATA?.organizationId as string;
		const { apiKey } = await createApiKey({
			name: "No-scope key",
			organizationId,
			permissions: [],
		});

		const listResponse = await app.request("/v1/webhooks/endpoints", {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				url: "https://example.com/webhooks/scope-test",
			}),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});

		expect(listResponse.status).toBe(403);
		expect(createResponse.status).toBe(403);
	});

	test("denies a webhooks:read-only key on signing-secret reveal/rotate and write routes", async () => {
		const organizationId = TEST_DATA?.organizationId as string;
		const { apiKey: readOnlyKey } = await createApiKey({
			name: "webhooks:read only",
			organizationId,
			permissions: ["webhooks:read"],
		});

		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				url: "https://example.com/webhooks/scope-test-2",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		const created = (await createResponse.json()) as {
			data: { endpoint: { id: string } };
		};
		const endpointId = created.data.endpoint.id;

		const listResponse = await app.request("/v1/webhooks/endpoints", {
			headers: { Authorization: `Bearer ${readOnlyKey}` },
		});
		const revealResponse = await app.request(
			`/v1/webhooks/endpoints/${endpointId}/signing-secret/reveal`,
			{
				headers: { Authorization: `Bearer ${readOnlyKey}` },
				method: "POST",
			},
		);
		const rotateResponse = await app.request(
			`/v1/webhooks/endpoints/${endpointId}/signing-secret/rotate`,
			{
				headers: { Authorization: `Bearer ${readOnlyKey}` },
				method: "POST",
			},
		);
		const deleteResponse = await app.request(
			`/v1/webhooks/endpoints/${endpointId}`,
			{
				headers: { Authorization: `Bearer ${readOnlyKey}` },
				method: "DELETE",
			},
		);

		expect(listResponse.status).toBe(200);
		expect(revealResponse.status).toBe(403);
		expect(rotateResponse.status).toBe(403);
		expect(deleteResponse.status).toBe(403);
	});

	test("allows webhooks:write key on signing-secret reveal", async () => {
		const organizationId = TEST_DATA?.organizationId as string;
		const { apiKey: writeKey } = await createApiKey({
			name: "webhooks:write",
			organizationId,
			permissions: ["webhooks:write"],
		});

		const createResponse = await app.request("/v1/webhooks/endpoints", {
			body: JSON.stringify({
				url: "https://example.com/webhooks/scope-test-3",
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		const created = (await createResponse.json()) as {
			data: { endpoint: { id: string } };
		};
		const endpointId = created.data.endpoint.id;

		const revealResponse = await app.request(
			`/v1/webhooks/endpoints/${endpointId}/signing-secret/reveal`,
			{
				headers: { Authorization: `Bearer ${writeKey}` },
				method: "POST",
			},
		);

		expect(revealResponse.status).toBe(200);
	});
});
