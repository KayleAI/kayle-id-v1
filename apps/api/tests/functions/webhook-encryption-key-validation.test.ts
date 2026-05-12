import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { webhook_encryption_keys } from "@kayle-id/database/schema/webhooks";
import app from "@/index";
import { loadTestPublicJwk } from "../helpers/webhook-fixtures";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;

function requireTestData(): TestData {
	if (!TEST_DATA) {
		throw new Error("webhook_key_validation_test_data_missing");
	}

	return TEST_DATA;
}

function authHeaders(): HeadersInit {
	return {
		Authorization: `Bearer ${requireTestData().apiKey}`,
		"Content-Type": "application/json",
	};
}

async function createEndpoint(): Promise<string> {
	const response = await app.request("/v1/webhooks/endpoints", {
		body: JSON.stringify({
			url: `https://example.com/webhook-key-validation/${crypto.randomUUID()}`,
		}),
		headers: authHeaders(),
		method: "POST",
	});

	expect(response.status).toBe(200);
	const payload = (await response.json()) as {
		data: { endpoint: { id: string } };
		error: null;
	};

	return payload.data.endpoint.id;
}

async function createKey({
	endpointId,
	jwk,
	keyId = `rsa-key-${crypto.randomUUID()}`,
}: {
	endpointId: string;
	jwk: Record<string, unknown>;
	keyId?: string;
}): Promise<Response> {
	return app.request(`/v1/webhooks/endpoints/${endpointId}/keys`, {
		body: JSON.stringify({
			algorithm: "RSA-OAEP-256",
			jwk,
			key_id: keyId,
			key_type: "RSA",
		}),
		headers: authHeaders(),
		method: "POST",
	});
}

async function listKeys({
	endpointId,
	isActive,
}: {
	endpointId: string;
	isActive: boolean;
}): Promise<Array<{ id: string; is_active: boolean; key_id: string }>> {
	const response = await app.request(
		`/v1/webhooks/endpoints/${endpointId}/keys?is_active=${String(isActive)}&limit=10`,
		{
			headers: authHeaders(),
			method: "GET",
		},
	);

	expect(response.status).toBe(200);
	const payload = (await response.json()) as {
		data: Array<{ id: string; is_active: boolean; key_id: string }>;
		error: null;
	};

	expect(payload.error).toBeNull();
	return payload.data;
}

async function generateWeakRsaPublicJwk(): Promise<JsonWebKey> {
	const keyPair = (await crypto.subtle.generateKey(
		{
			hash: "SHA-256",
			modulusLength: 1024,
			name: "RSA-OAEP",
			publicExponent: new Uint8Array([1, 0, 1]),
		},
		true,
		["encrypt", "decrypt"],
	)) as CryptoKeyPair;

	return (await crypto.subtle.exportKey(
		"jwk",
		keyPair.publicKey,
	)) as JsonWebKey;
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

describe("webhook encryption key validation", () => {
	test("normalizes accepted RSA public JWKs before storage", async () => {
		const endpointId = await createEndpoint();
		const publicJwk = await loadTestPublicJwk();
		const response = await createKey({
			endpointId,
			jwk: publicJwk as unknown as Record<string, unknown>,
			keyId: "rsa-key-public",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: { jwk: Record<string, unknown> };
			error: null;
		};

		expect(payload.data.jwk).toMatchObject({
			alg: "RSA-OAEP-256",
			key_ops: ["encrypt"],
			kty: "RSA",
		});
		expect(payload.data.jwk).not.toHaveProperty("d");
		expect(payload.data.jwk).not.toHaveProperty("p");
		expect(payload.data.jwk).not.toHaveProperty("q");
	});

	test("rejects private JWK material before rotating the active key", async () => {
		const endpointId = await createEndpoint();
		const publicJwk = (await loadTestPublicJwk()) as unknown as Record<
			string,
			unknown
		>;
		const initialResponse = await createKey({
			endpointId,
			jwk: publicJwk,
			keyId: "rsa-key-original",
		});
		const initialPayload = (await initialResponse.json()) as {
			data: { id: string };
		};

		expect(initialResponse.status).toBe(200);

		const rejectedResponse = await createKey({
			endpointId,
			jwk: {
				...publicJwk,
				d: "private-key-material",
			},
			keyId: "rsa-key-private",
		});

		expect(rejectedResponse.status).toBe(400);
		const rejectedPayload = (await rejectedResponse.json()) as {
			error: { code: string };
		};
		expect(rejectedPayload.error.code).toBe("BAD_REQUEST");

		const activeListResponse = await app.request(
			`/v1/webhooks/endpoints/${endpointId}/keys?is_active=true`,
			{
				headers: authHeaders(),
				method: "GET",
			},
		);
		const activeListPayload = (await activeListResponse.json()) as {
			data: Array<{ id: string; key_id: string }>;
		};

		expect(activeListPayload.data).toHaveLength(1);
		expect(activeListPayload.data[0]?.id).toBe(initialPayload.data.id);
		expect(activeListPayload.data[0]?.key_id).toBe("rsa-key-original");
	});

	test("reactivating an old key deactivates the current active key", async () => {
		const endpointId = await createEndpoint();
		const publicJwk = (await loadTestPublicJwk()) as unknown as Record<
			string,
			unknown
		>;
		const oldResponse = await createKey({
			endpointId,
			jwk: publicJwk,
			keyId: "rsa-key-old",
		});
		const oldPayload = (await oldResponse.json()) as {
			data: { id: string; key_id: string };
		};

		expect(oldResponse.status).toBe(200);

		const currentResponse = await createKey({
			endpointId,
			jwk: publicJwk,
			keyId: "rsa-key-current",
		});
		const currentPayload = (await currentResponse.json()) as {
			data: { id: string; key_id: string };
		};

		expect(currentResponse.status).toBe(200);

		const activeBefore = await listKeys({ endpointId, isActive: true });
		expect(activeBefore).toHaveLength(1);
		expect(activeBefore[0]?.id).toBe(currentPayload.data.id);

		const reactivateResponse = await app.request(
			`/v1/webhooks/keys/${oldPayload.data.id}/reactivate`,
			{
				headers: authHeaders(),
				method: "POST",
			},
		);

		expect(reactivateResponse.status).toBe(200);

		const activeAfter = await listKeys({ endpointId, isActive: true });
		expect(activeAfter).toHaveLength(1);
		expect(activeAfter[0]?.id).toBe(oldPayload.data.id);
		expect(activeAfter[0]?.key_id).toBe("rsa-key-old");

		const inactiveAfter = await listKeys({ endpointId, isActive: false });
		expect(inactiveAfter).toHaveLength(1);
		expect(inactiveAfter[0]?.id).toBe(currentPayload.data.id);
		expect(inactiveAfter[0]?.key_id).toBe("rsa-key-current");
	});

	test("database rejects multiple active keys for one endpoint", async () => {
		const endpointId = await createEndpoint();
		const publicJwk = (await loadTestPublicJwk()) as unknown as Record<
			string,
			unknown
		>;
		const initialResponse = await createKey({
			endpointId,
			jwk: publicJwk,
			keyId: "rsa-key-single-active",
		});

		expect(initialResponse.status).toBe(200);

		let duplicateError: unknown;

		try {
			await db.insert(webhook_encryption_keys).values({
				algorithm: "RSA-OAEP-256",
				id: `whk_${crypto.randomUUID()}`,
				isActive: true,
				jwk: publicJwk,
				keyId: "rsa-key-duplicate-active",
				keyType: "RSA",
				webhookEndpointId: endpointId,
			});
		} catch (error) {
			duplicateError = error;
		}

		expect(duplicateError).toBeInstanceOf(Error);

		const activeAfter = await listKeys({ endpointId, isActive: true });
		expect(activeAfter).toHaveLength(1);
		expect(activeAfter[0]?.key_id).toBe("rsa-key-single-active");
	});

	test("rejects malformed RSA public JWKs", async () => {
		const endpointId = await createEndpoint();
		const response = await createKey({
			endpointId,
			jwk: {
				kty: "RSA",
				n: "missing-exponent",
			},
			keyId: "rsa-key-malformed",
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string };
		};
		expect(payload.error.code).toBe("BAD_REQUEST");
	});

	test("rejects encryption key requests that exceed route bounds", async () => {
		const endpointId = await createEndpoint();
		const publicJwk = (await loadTestPublicJwk()) as unknown as Record<
			string,
			unknown
		>;
		const keyIdResponse = await createKey({
			endpointId,
			jwk: publicJwk,
			keyId: "k".repeat(129),
		});
		const jwkResponse = await createKey({
			endpointId,
			jwk: {
				...publicJwk,
				n: "a".repeat(8193),
			},
			keyId: "rsa-key-oversized-jwk",
		});

		expect(keyIdResponse.status).toBe(400);
		expect(jwkResponse.status).toBe(400);
	});

	test("rejects RSA public JWKs with weak moduli", async () => {
		const endpointId = await createEndpoint();
		const weakPublicJwk = await generateWeakRsaPublicJwk();
		const response = await createKey({
			endpointId,
			jwk: weakPublicJwk as unknown as Record<string, unknown>,
			keyId: "rsa-key-weak",
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string };
		};
		expect(payload.error.code).toBe("BAD_REQUEST");
	});
});
