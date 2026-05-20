import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { events as coreEvents } from "@kayle-id/database/schema/core";
import {
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { file } from "bun";
import { exportJWK, importSPKI } from "jose";
import {
	createWebhookDeliveriesForVerificationSessionFailed,
	createWebhookDeliveriesForVerificationSessionSucceededWithManifest,
} from "@/v1/webhooks/deliveries/service";
import { encryptWebhookSigningSecret } from "@/v1/webhooks/signing-secret";

type SupportedSeedEventType =
	| "verification.session.failed"
	| "verification.session.succeeded";

export async function loadTestPublicJwk(): Promise<JsonWebKey> {
	const publicKeyText = await file(
		new URL("../../../../tests/secrets/rsa_public.pem", import.meta.url),
	).text();
	const jwk = await exportJWK(await importSPKI(publicKeyText, "RSA-OAEP-256"));

	return {
		...jwk,
		kty: jwk.kty ?? "RSA",
	};
}

export async function seedWebhookEndpoint({
	context,
	organizationId,
	eventTypes,
	signingSecretPlaintext,
	url,
}: {
	context: string;
	organizationId: string;
	eventTypes: readonly string[];
	signingSecretPlaintext: string;
	url: string;
}): Promise<typeof webhook_endpoints.$inferSelect> {
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: signingSecretPlaintext,
		secret: env.AUTH_SECRET,
	});

	const [endpoint] = await db
		.insert(webhook_endpoints)
		.values({
			id: `whe_${context}_${crypto.randomUUID()}`,
			organizationId,
			signingSecretCiphertext,
			subscribedEventTypes: [...eventTypes],
			url,
		})
		.returning();

	if (!endpoint) {
		throw new Error("expected_webhook_endpoint_to_be_created");
	}

	return endpoint;
}

export async function seedWebhookEncryptionKey({
	context,
	endpointId,
	jwk,
}: {
	context: string;
	endpointId: string;
	jwk: JsonWebKey;
}): Promise<void> {
	await db.insert(webhook_encryption_keys).values({
		id: `whk_${context}_${crypto.randomUUID()}`,
		webhookEndpointId: endpointId,
		keyId: `rsa-key-${context}`,
		algorithm: "RSA-OAEP-256",
		keyType: "RSA",
		jwk,
	});
}

export async function seedCoreEvent({
	context,
	organizationId,
	type,
}: {
	context: string;
	organizationId: string;
	type: SupportedSeedEventType;
}): Promise<typeof coreEvents.$inferSelect> {
	const [event] = await db
		.insert(coreEvents)
		.values({
			id: `evt_${context}_${crypto.randomUUID()}`,
			organizationId,
			type,
			triggerId: `va_${context}_${crypto.randomUUID()}`,
			triggerType: "verification_attempt",
		})
		.returning();

	if (!event) {
		throw new Error("expected_core_event_to_be_created");
	}

	return event;
}

export async function seedWebhookEventWithDelivery({
	context,
	eventType,
	organizationId,
	signingSecretPlaintext = `whsec_${context}_secret`,
	url = `https://example.com/webhooks/${context}`,
}: {
	context: string;
	eventType: SupportedSeedEventType;
	organizationId: string;
	signingSecretPlaintext?: string;
	url?: string;
}): Promise<{
	deliveryId: string;
	endpointId: string;
	eventId: string;
}> {
	const publicJwk = await loadTestPublicJwk();
	const endpoint = await seedWebhookEndpoint({
		context,
		organizationId,
		eventTypes: [eventType],
		signingSecretPlaintext,
		url,
	});

	await seedWebhookEncryptionKey({
		context,
		endpointId: endpoint.id,
		jwk: publicJwk,
	});

	const event = await seedCoreEvent({
		context,
		organizationId,
		type: eventType,
	});

	const deliveryIds =
		eventType === "verification.session.succeeded"
			? await createWebhookDeliveriesForVerificationSessionSucceededWithManifest(
					{
						eventId: event.id,
						manifest: {
							claims: {
								family_name: "DOE",
							},
							contractVersion: 1,
							selectedFieldKeys: ["family_name"],
							sessionId: `vs_${context}_${crypto.randomUUID()}`,
						},
						organizationId,
					},
				)
			: await createWebhookDeliveriesForVerificationSessionFailed({
					contractVersion: 1,
					eventId: event.id,
					failureCode: "selfie_face_mismatch",
					nfcTriesUsed: 3,
					livenessTriesUsed: 0,
					organizationId,
					sessionId: `vs_${context}_${crypto.randomUUID()}`,
				});

	const [deliveryId] = deliveryIds;

	if (!deliveryId) {
		throw new Error("expected_webhook_delivery_to_be_created");
	}

	return {
		deliveryId,
		endpointId: endpoint.id,
		eventId: event.id,
	};
}
