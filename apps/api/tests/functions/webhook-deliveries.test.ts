import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { file } from "bun";
import { eq, isNotNull } from "drizzle-orm";
import { compactDecrypt, exportJWK, importPKCS8, importSPKI } from "jose";
import {
	attemptWebhookDelivery,
	createWebhookDeliveriesForVerificationAttemptFailed,
	createWebhookDeliveriesForVerificationSessionCancelled,
	createWebhookDeliveriesForVerificationSucceeded,
	finalizeWebhookDeliveryFailure,
	getWebhookEndpointLogTarget,
	runWebhookPayloadRetentionSweep,
} from "@/v1/webhooks/deliveries/service";
import { encryptWebhookSigningSecret } from "@/v1/webhooks/signing-secret";
import { createMockFetch } from "../helpers/mock-fetch";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;

const originalFetch = globalThis.fetch;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

afterEach(async () => {
	if (!TEST_DATA?.organizationId) {
		return;
	}

	await db
		.delete(webhook_endpoints)
		.where(eq(webhook_endpoints.organizationId, TEST_DATA.organizationId));
	await db
		.delete(events)
		.where(eq(events.organizationId, TEST_DATA.organizationId));
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

test("getWebhookEndpointLogTarget logs only the webhook origin", () => {
	expect(
		getWebhookEndpointLogTarget(
			"https://user:pass@example.com/webhooks/kayle?token=secret#fragment",
		),
	).toBe("https://example.com");
	expect(getWebhookEndpointLogTarget("/webhooks/kayle?token=secret")).toBe(
		"invalid_webhook_url",
	);
});

async function seedPendingWebhookDelivery({
	context,
	url,
}: {
	context: string;
	url: string;
}): Promise<string> {
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: `whsec_${context}`,
		secret: env.AUTH_SECRET,
	});
	const endpointId = `whe_${context}_${crypto.randomUUID()}`;
	const eventId = `evt_${context}_${crypto.randomUUID()}`;
	const deliveryId = `whd_${context}_${crypto.randomUUID()}`;

	const [endpoint] = await db
		.insert(webhook_endpoints)
		.values({
			id: endpointId,
			organizationId: TEST_DATA?.organizationId ?? "",
			signingSecretCiphertext,
			subscribedEventTypes: ["verification.attempt.failed"],
			url,
		})
		.returning();

	const [event] = await db
		.insert(events)
		.values({
			id: eventId,
			organizationId: TEST_DATA?.organizationId ?? "",
			type: "verification.attempt.failed",
			triggerId: `va_${context}`,
			triggerType: "verification_attempt",
		})
		.returning();

	await db.insert(webhook_deliveries).values({
		eventId: event.id,
		id: deliveryId,
		payload: "{}",
		status: "pending",
		webhookEndpointId: endpoint.id,
		webhookEncryptionKeyId: null,
	});

	return deliveryId;
}

test("createWebhookDeliveriesForVerificationSucceeded creates a pending encrypted delivery for subscribed endpoints", async () => {
	const publicKeyText = await file(
		new URL("../../../../tests/secrets/rsa_public.pem", import.meta.url),
	).text();
	const publicJwk = await exportJWK(
		await importSPKI(publicKeyText, "RSA-OAEP-256"),
	);
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: "whsec_delivery_secret",
		secret: env.AUTH_SECRET,
	});

	const [endpoint] = await db
		.insert(webhook_endpoints)
		.values({
			id: "whe_delivery_pending",
			organizationId: TEST_DATA?.organizationId ?? "",
			signingSecretCiphertext,
			subscribedEventTypes: ["verification.attempt.succeeded"],
			url: "https://example.com/webhooks/kayle",
		})
		.returning();

	const [key] = await db
		.insert(webhook_encryption_keys)
		.values({
			id: "whk_delivery_pending",
			webhookEndpointId: endpoint.id,
			keyId: "rsa-key-1",
			algorithm: "RSA-OAEP-256",
			keyType: "RSA",
			jwk: publicJwk,
		})
		.returning();

	const [event] = await db
		.insert(events)
		.values({
			id: "evt_delivery_pending",
			organizationId: TEST_DATA?.organizationId ?? "",
			type: "verification.attempt.succeeded",
			triggerId: "va_delivery_pending",
			triggerType: "verification_attempt",
		})
		.returning();

	const deliveryIds = await createWebhookDeliveriesForVerificationSucceeded({
		attemptId: "va_delivery_pending",
		eventId: event.id,
		manifest: {
			claims: {
				family_name: "DOE",
				nationality_code: null,
			},
			contractVersion: 1,
			selectedFieldKeys: ["family_name"],
			sessionId: "vs_delivery_pending",
		},
		organizationId: TEST_DATA?.organizationId ?? "",
	});

	expect(deliveryIds).toHaveLength(1);
	expect(deliveryIds[0]?.startsWith("whd_")).toBeTrue();

	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryIds[0] ?? ""))
		.limit(1);

	expect(delivery?.status).toBe("pending");
	expect(delivery?.webhookEncryptionKeyId).toBe(key.id);
	expect(delivery?.payload).toBeString();

	const privateKeyText = await file(
		new URL("../../../../tests/secrets/rsa_private.pem", import.meta.url),
	).text();
	const { plaintext } = await compactDecrypt(
		delivery?.payload ?? "",
		await importPKCS8(privateKeyText, "RSA-OAEP-256"),
	);
	const decodedPayload = JSON.parse(new TextDecoder().decode(plaintext)) as {
		data: {
			claims: {
				family_name: string;
				nationality_code: string | null;
			};
			selected_field_keys: string[];
		};
		metadata: {
			contract_version: number;
			event_id: string;
			verification_attempt_id: string;
			verification_session_id: string;
		};
		type: string;
	};

	expect(decodedPayload.type).toBe("verification.attempt.succeeded");
	expect(decodedPayload.data.claims.family_name).toBe("DOE");
	expect(decodedPayload.data.claims.nationality_code).toBeNull();
	expect(decodedPayload.data.selected_field_keys).toEqual(["family_name"]);
	expect(decodedPayload.metadata.contract_version).toBe(1);
	expect(decodedPayload.metadata.event_id).toBe(event.id);
	expect(decodedPayload.metadata.verification_attempt_id).toBe(
		"va_delivery_pending",
	);
	expect(decodedPayload.metadata.verification_session_id).toBe(
		"vs_delivery_pending",
	);
});

test("createWebhookDeliveriesForVerificationAttemptFailed creates a pending encrypted delivery for subscribed endpoints", async () => {
	const publicKeyText = await file(
		new URL("../../../../tests/secrets/rsa_public.pem", import.meta.url),
	).text();
	const publicJwk = await exportJWK(
		await importSPKI(publicKeyText, "RSA-OAEP-256"),
	);
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: "whsec_delivery_failed_secret",
		secret: env.AUTH_SECRET,
	});

	const [endpoint] = await db
		.insert(webhook_endpoints)
		.values({
			id: "whe_delivery_failed",
			organizationId: TEST_DATA?.organizationId ?? "",
			signingSecretCiphertext,
			subscribedEventTypes: ["verification.attempt.failed"],
			url: "https://example.com/webhooks/kayle/failed",
		})
		.returning();

	const [key] = await db
		.insert(webhook_encryption_keys)
		.values({
			id: "whk_delivery_failed",
			webhookEndpointId: endpoint.id,
			keyId: "rsa-key-3",
			algorithm: "RSA-OAEP-256",
			keyType: "RSA",
			jwk: publicJwk,
		})
		.returning();

	const [event] = await db
		.insert(events)
		.values({
			id: "evt_delivery_failed",
			organizationId: TEST_DATA?.organizationId ?? "",
			type: "verification.attempt.failed",
			triggerId: "va_delivery_failed",
			triggerType: "verification_attempt",
		})
		.returning();

	const [deliveryId] =
		await createWebhookDeliveriesForVerificationAttemptFailed({
			attemptId: "va_delivery_failed",
			contractVersion: 1,
			eventId: event.id,
			failureCode: "selfie_face_mismatch",
			organizationId: TEST_DATA?.organizationId ?? "",
			sessionId: "vs_delivery_failed",
		});

	expect(deliveryId?.startsWith("whd_")).toBeTrue();

	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId ?? ""))
		.limit(1);

	expect(delivery?.status).toBe("pending");
	expect(delivery?.webhookEncryptionKeyId).toBe(key.id);
	expect(delivery?.payload).toBeString();

	const privateKeyText = await file(
		new URL("../../../../tests/secrets/rsa_private.pem", import.meta.url),
	).text();
	const { plaintext } = await compactDecrypt(
		delivery?.payload ?? "",
		await importPKCS8(privateKeyText, "RSA-OAEP-256"),
	);
	const decodedPayload = JSON.parse(new TextDecoder().decode(plaintext)) as {
		data: {
			failure_code: string;
		};
		metadata: {
			contract_version: number;
			event_id: string;
			verification_attempt_id: string;
			verification_session_id: string;
		};
		type: string;
	};

	expect(decodedPayload.type).toBe("verification.attempt.failed");
	expect(decodedPayload.data.failure_code).toBe("selfie_face_mismatch");
	expect(decodedPayload.metadata.contract_version).toBe(1);
	expect(decodedPayload.metadata.event_id).toBe(event.id);
	expect(decodedPayload.metadata.verification_attempt_id).toBe(
		"va_delivery_failed",
	);
	expect(decodedPayload.metadata.verification_session_id).toBe(
		"vs_delivery_failed",
	);
});

test("createWebhookDeliveriesForVerificationSessionCancelled creates a pending encrypted delivery for subscribed endpoints", async () => {
	const publicKeyText = await file(
		new URL("../../../../tests/secrets/rsa_public.pem", import.meta.url),
	).text();
	const publicJwk = await exportJWK(
		await importSPKI(publicKeyText, "RSA-OAEP-256"),
	);
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: "whsec_delivery_cancelled_secret",
		secret: env.AUTH_SECRET,
	});

	const [endpoint] = await db
		.insert(webhook_endpoints)
		.values({
			id: "whe_delivery_cancelled",
			organizationId: TEST_DATA?.organizationId ?? "",
			signingSecretCiphertext,
			subscribedEventTypes: ["verification.session.cancelled"],
			url: "https://example.com/webhooks/kayle/cancelled",
		})
		.returning();

	const [key] = await db
		.insert(webhook_encryption_keys)
		.values({
			id: "whk_delivery_cancelled",
			webhookEndpointId: endpoint.id,
			keyId: "rsa-key-4",
			algorithm: "RSA-OAEP-256",
			keyType: "RSA",
			jwk: publicJwk,
		})
		.returning();

	const [event] = await db
		.insert(events)
		.values({
			id: "evt_delivery_cancelled",
			organizationId: TEST_DATA?.organizationId ?? "",
			type: "verification.session.cancelled",
			triggerId: "vs_delivery_cancelled",
			triggerType: "verification_session",
		})
		.returning();

	const [deliveryId] =
		await createWebhookDeliveriesForVerificationSessionCancelled({
			contractVersion: 1,
			eventId: event.id,
			organizationId: TEST_DATA?.organizationId ?? "",
			sessionId: "vs_delivery_cancelled",
		});

	expect(deliveryId?.startsWith("whd_")).toBeTrue();

	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId ?? ""))
		.limit(1);

	expect(delivery?.status).toBe("pending");
	expect(delivery?.webhookEncryptionKeyId).toBe(key.id);
	expect(delivery?.payload).toBeString();

	const privateKeyText = await file(
		new URL("../../../../tests/secrets/rsa_private.pem", import.meta.url),
	).text();
	const { plaintext } = await compactDecrypt(
		delivery?.payload ?? "",
		await importPKCS8(privateKeyText, "RSA-OAEP-256"),
	);
	const decodedPayload = JSON.parse(new TextDecoder().decode(plaintext)) as {
		data: Record<string, never>;
		metadata: {
			contract_version: number;
			event_id: string;
			verification_session_id: string;
		};
		type: string;
	};

	expect(decodedPayload.type).toBe("verification.session.cancelled");
	expect(decodedPayload.data).toEqual({});
	expect(decodedPayload.metadata.contract_version).toBe(1);
	expect(decodedPayload.metadata.event_id).toBe(event.id);
	expect(decodedPayload.metadata.verification_session_id).toBe(
		"vs_delivery_cancelled",
	);
});

test("attemptWebhookDelivery signs and delivers the encrypted payload with the matching event header", async () => {
	const publicKeyText = await file(
		new URL("../../../../tests/secrets/rsa_public.pem", import.meta.url),
	).text();
	const publicJwk = await exportJWK(
		await importSPKI(publicKeyText, "RSA-OAEP-256"),
	);
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: "whsec_delivery_sign",
		secret: env.AUTH_SECRET,
	});

	const [endpoint] = await db
		.insert(webhook_endpoints)
		.values({
			id: "whe_delivery_send",
			organizationId: TEST_DATA?.organizationId ?? "",
			signingSecretCiphertext,
			subscribedEventTypes: ["verification.attempt.failed"],
			url: "https://example.com/webhooks/send",
		})
		.returning();
	await db.insert(webhook_encryption_keys).values({
		id: "whk_delivery_send",
		webhookEndpointId: endpoint.id,
		keyId: "rsa-key-2",
		algorithm: "RSA-OAEP-256",
		keyType: "RSA",
		jwk: publicJwk,
	});
	const [event] = await db
		.insert(events)
		.values({
			id: "evt_delivery_send",
			organizationId: TEST_DATA?.organizationId ?? "",
			type: "verification.attempt.failed",
			triggerId: "va_delivery_send",
			triggerType: "verification_attempt",
		})
		.returning();

	const [deliveryId] =
		await createWebhookDeliveriesForVerificationAttemptFailed({
			attemptId: "va_delivery_send",
			contractVersion: 1,
			eventId: event.id,
			failureCode: "document_authenticity_failed",
			organizationId: TEST_DATA?.organizationId ?? "",
			sessionId: "vs_delivery_send",
		});

	let capturedSignature: string | null = null;
	let capturedContentType: string | null = null;
	let capturedEventType = "";
	let capturedBody = "";

	globalThis.fetch = createMockFetch(
		async (_input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request("https://example.com/webhooks/send", init);
			capturedSignature = request.headers.get("X-Kayle-Signature");
			capturedContentType = request.headers.get("Content-Type");
			capturedEventType = request.headers.get("X-Kayle-Event") ?? "";
			capturedBody = await request.text();

			return new Response(null, {
				status: 202,
			});
		},
	);

	const result = await attemptWebhookDelivery({
		authSecret: env.AUTH_SECRET,
		deliveryId,
	});

	if (!capturedContentType) {
		throw new Error("webhook_delivery_content_type_missing");
	}

	if (!capturedSignature) {
		throw new Error("webhook_delivery_headers_missing");
	}

	const contentType: string = capturedContentType;
	const signature: string = capturedSignature;

	expect(result?.status).toBe("succeeded");
	expect(result?.attempt_count).toBe(1);
	expect(contentType).toBe("application/jose");
	expect(capturedEventType).toBe("verification.attempt.failed");
	expect(signature.startsWith("t=")).toBeTrue();
	expect(capturedBody).toBeString();

	const [updatedDelivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	expect(updatedDelivery?.status).toBe("succeeded");
	expect(updatedDelivery?.lastStatusCode).toBe(202);
	expect(updatedDelivery?.payload).toBeNull();
	expect(updatedDelivery?.payloadExpiresAt).toBeNull();
	expect(updatedDelivery?.payloadRetentionReason).toBe("delivered");
	expect(updatedDelivery?.payloadScrubbedAt).toBeInstanceOf(Date);
	expect(updatedDelivery?.webhookEncryptionKeyId).toBe("whk_delivery_send");
});

test("finalizeWebhookDeliveryFailure retains failed payloads for the endpoint replay window", async () => {
	const deliveryId = await seedPendingWebhookDelivery({
		context: "failed_retention",
		url: "https://example.com/webhooks/failed-retention",
	});
	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	await db
		.update(webhook_endpoints)
		.set({
			undeliveredPayloadRetentionHours: 24,
		})
		.where(eq(webhook_endpoints.id, delivery?.webhookEndpointId ?? ""));

	const before = Date.now();
	await finalizeWebhookDeliveryFailure({ deliveryId });
	const after = Date.now();

	const [updatedDelivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	expect(updatedDelivery?.status).toBe("failed");
	expect(updatedDelivery?.payload).toBe("{}");
	expect(updatedDelivery?.payloadRetentionReason).toBe(
		"terminal_failure_retention",
	);
	expect(updatedDelivery?.payloadScrubbedAt).toBeNull();
	expect(updatedDelivery?.payloadExpiresAt?.getTime()).toBeGreaterThanOrEqual(
		before + 24 * 60 * 60_000,
	);
	expect(updatedDelivery?.payloadExpiresAt?.getTime()).toBeLessThanOrEqual(
		after + 24 * 60 * 60_000,
	);
});

test("finalizeWebhookDeliveryFailure scrubs failed payloads immediately for zero-hour retention", async () => {
	const deliveryId = await seedPendingWebhookDelivery({
		context: "failed_zero_retention",
		url: "https://example.com/webhooks/failed-zero-retention",
	});
	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	await db
		.update(webhook_endpoints)
		.set({
			undeliveredPayloadRetentionHours: 0,
		})
		.where(eq(webhook_endpoints.id, delivery?.webhookEndpointId ?? ""));

	await finalizeWebhookDeliveryFailure({ deliveryId });

	const [updatedDelivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	expect(updatedDelivery?.status).toBe("failed");
	expect(updatedDelivery?.payload).toBeNull();
	expect(updatedDelivery?.payloadExpiresAt).toBeNull();
	expect(updatedDelivery?.payloadRetentionReason).toBe("expired");
	expect(updatedDelivery?.payloadScrubbedAt).toBeInstanceOf(Date);
});

test("runWebhookPayloadRetentionSweep scrubs expired retained payloads without touching metadata", async () => {
	const deliveryId = await seedPendingWebhookDelivery({
		context: "retention_sweep",
		url: "https://example.com/webhooks/retention-sweep",
	});
	const now = new Date("2099-01-02T00:00:00.000Z");

	await db
		.update(webhook_deliveries)
		.set({
			payloadExpiresAt: new Date("2100-01-01T00:00:00.000Z"),
		})
		.where(isNotNull(webhook_deliveries.payload));

	await db
		.update(webhook_deliveries)
		.set({
			payloadExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
			payloadRetentionReason: "terminal_failure_retention",
			status: "failed",
		})
		.where(eq(webhook_deliveries.id, deliveryId));

	const result = await runWebhookPayloadRetentionSweep({ now });

	expect(result).toEqual({
		failed: false,
		orgCount: 1,
		scrubbedCount: 1,
	});

	const [updatedDelivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	expect(updatedDelivery?.payload).toBeNull();
	expect(updatedDelivery?.payloadExpiresAt).toBeNull();
	expect(updatedDelivery?.payloadRetentionReason).toBe("expired");
	expect(updatedDelivery?.payloadScrubbedAt?.toISOString()).toBe(
		now.toISOString(),
	);
	expect(updatedDelivery?.status).toBe("failed");
});

test("attemptWebhookDelivery does not resend deliveries that already succeeded", async () => {
	const deliveryId = await seedPendingWebhookDelivery({
		context: "already_succeeded",
		url: "https://example.com/webhooks/already-succeeded",
	});
	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: 1,
			lastAttemptAt: new Date("2099-01-01T00:00:00.000Z"),
			lastStatusCode: 202,
			status: "succeeded",
		})
		.where(eq(webhook_deliveries.id, deliveryId));

	let fetchCount = 0;
	globalThis.fetch = createMockFetch(async () => {
		fetchCount += 1;
		return new Response(null, { status: 202 });
	});

	const result = await attemptWebhookDelivery({
		authSecret: env.AUTH_SECRET,
		deliveryId,
	});

	expect(fetchCount).toBe(0);
	expect(result?.status).toBe("succeeded");
	expect(result?.attempt_count).toBe(1);
	expect(result?.last_status_code).toBe(202);
});

test("concurrent attemptWebhookDelivery calls claim a pending delivery once", async () => {
	const deliveryId = await seedPendingWebhookDelivery({
		context: "single_claim",
		url: "https://example.com/webhooks/single-claim",
	});

	let fetchCount = 0;
	globalThis.fetch = createMockFetch(async () => {
		fetchCount += 1;
		await new Promise((resolve) => setTimeout(resolve, 10));
		return new Response(null, { status: 202 });
	});

	await Promise.all([
		attemptWebhookDelivery({
			authSecret: env.AUTH_SECRET,
			deliveryId,
		}),
		attemptWebhookDelivery({
			authSecret: env.AUTH_SECRET,
			deliveryId,
		}),
	]);

	const [updatedDelivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	expect(fetchCount).toBe(1);
	expect(updatedDelivery?.status).toBe("succeeded");
	expect(updatedDelivery?.attemptCount).toBe(1);
	expect(updatedDelivery?.lastStatusCode).toBe(202);
});

test("attemptWebhookDelivery rejects stale unsafe endpoint URLs before fetch", async () => {
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: "whsec_delivery_rejected_url",
		secret: env.AUTH_SECRET,
	});

	const [endpoint] = await db
		.insert(webhook_endpoints)
		.values({
			id: "whe_delivery_rejected_url",
			organizationId: TEST_DATA?.organizationId ?? "",
			signingSecretCiphertext,
			subscribedEventTypes: ["verification.attempt.failed"],
			url: "https://10.0.0.1/webhooks/rejected",
		})
		.returning();

	const [event] = await db
		.insert(events)
		.values({
			id: "evt_delivery_rejected_url",
			organizationId: TEST_DATA?.organizationId ?? "",
			type: "verification.attempt.failed",
			triggerId: "va_delivery_rejected_url",
			triggerType: "verification_attempt",
		})
		.returning();

	await db.insert(webhook_deliveries).values({
		eventId: event.id,
		id: "whd_delivery_rejected_url",
		payload: "{}",
		status: "pending",
		webhookEndpointId: endpoint.id,
		webhookEncryptionKeyId: null,
	});

	globalThis.fetch = createMockFetch(() => {
		throw new Error("unsafe_webhook_url_should_not_fetch");
	});

	const result = await attemptWebhookDelivery({
		authSecret: env.AUTH_SECRET,
		deliveryId: "whd_delivery_rejected_url",
	});

	expect(result?.status).toBe("pending");
	expect(result?.attempt_count).toBe(1);
	expect(result?.last_status_code).toBe(400);

	const [updatedDelivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, "whd_delivery_rejected_url"))
		.limit(1);

	expect(updatedDelivery?.lastStatusCode).toBe(400);
});
