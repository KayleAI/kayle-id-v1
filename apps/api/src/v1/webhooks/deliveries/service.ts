import { indexBy } from "@kayle-id/config/collections";
import {
	createSafeRequestLogger,
	logSafeError,
} from "@kayle-id/config/logging";
import { parseSafeUrl } from "@kayle-id/config/safe-url";
import type { SupportedWebhookEventType } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { events } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_delivery_attempts,
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { createJWE } from "@/functions/jwe";
import { generateId } from "@/utils/generate-id";
import type { VerifyShareManifest } from "@/v1/verify/share-manifest";
import {
	createWebhookSignatureHeader,
	decryptWebhookSigningSecret,
} from "@/v1/webhooks/signing-secret";
import {
	buildVerificationAttemptFailedPayload,
	buildVerificationSessionCancelledPayload,
	buildVerificationSessionExpiredPayload,
	buildVerificationSucceededPayload,
} from "./payloads";
import {
	type DeliveryRowResponse,
	INITIAL_RETRY_DELAY_MS,
	MAX_DELIVERY_ATTEMPTS,
	type VerificationAttemptFailedCode,
	type WebhookPayload,
} from "./types";

function computeNextAttemptAt(attemptCount: number): Date | null {
	if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
		return null;
	}

	return new Date(
		Date.now() + INITIAL_RETRY_DELAY_MS * 2 ** (attemptCount - 1),
	);
}

function isSubscribedToEventType(
	subscribedEventTypes: unknown,
	eventType: SupportedWebhookEventType,
): boolean {
	return (
		Array.isArray(subscribedEventTypes) &&
		subscribedEventTypes.includes(eventType)
	);
}

function mapWebhookDeliveryRowToResponse(
	row: typeof webhook_deliveries.$inferSelect,
): DeliveryRowResponse {
	return {
		attempt_count: row.attemptCount,
		created_at: row.createdAt.toISOString(),
		event_id: row.eventId,
		id: row.id,
		last_attempt_at: row.lastAttemptAt?.toISOString() ?? null,
		last_status_code: row.lastStatusCode,
		next_attempt_at: row.nextAttemptAt?.toISOString() ?? null,
		status: row.status,
		updated_at: row.updatedAt.toISOString(),
		webhook_encryption_key_id: row.webhookEncryptionKeyId,
		webhook_endpoint_id: row.webhookEndpointId,
	};
}

async function insertAttempt({
	deliveryId,
	status,
	statusCode,
}: {
	deliveryId: string;
	status: "failed" | "succeeded";
	statusCode: number | null;
}): Promise<void> {
	const [delivery] = await db
		.select({
			environment: events.environment,
			organizationId: events.organizationId,
		})
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	if (!delivery) {
		throw new Error("webhook_delivery_missing_for_attempt");
	}

	await db.insert(webhook_delivery_attempts).values({
		id: generateId({
			type: "wha",
			environment: delivery.environment,
		}),
		status,
		statusCode,
		webhookDeliveryId: deliveryId,
	});
}

async function markDeliveryFailedWithoutSend({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<void> {
	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	if (!delivery) {
		return;
	}

	const nextAttemptCount = delivery.attemptCount + 1;
	const nextAttemptAt = computeNextAttemptAt(nextAttemptCount);
	const now = new Date();

	await insertAttempt({
		deliveryId,
		status: "failed",
		statusCode: null,
	});

	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: nextAttemptCount,
			lastAttemptAt: now,
			lastStatusCode: null,
			nextAttemptAt,
			status: nextAttemptAt ? "pending" : "failed",
		})
		.where(eq(webhook_deliveries.id, deliveryId));
}

async function getWebhookDeliveryById(
	deliveryId: string,
): Promise<typeof webhook_deliveries.$inferSelect | null> {
	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	return delivery ?? null;
}

async function getMappedWebhookDelivery(
	deliveryId: string,
): Promise<DeliveryRowResponse | null> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	return delivery ? mapWebhookDeliveryRowToResponse(delivery) : null;
}

async function markWebhookDeliveryFailedAndReload(
	deliveryId: string,
): Promise<DeliveryRowResponse | null> {
	await markDeliveryFailedWithoutSend({
		deliveryId,
	});

	return getMappedWebhookDelivery(deliveryId);
}

type DeliveryAttemptContext = {
	delivery: typeof webhook_deliveries.$inferSelect;
	endpoint: typeof webhook_endpoints.$inferSelect;
	eventType: SupportedWebhookEventType;
};

async function getDeliveryAttemptContext(
	deliveryId: string,
): Promise<DeliveryAttemptContext | null> {
	const [row] = await db
		.select({
			delivery: webhook_deliveries,
			endpoint: webhook_endpoints,
			eventType: events.type,
		})
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.innerJoin(
			webhook_endpoints,
			eq(webhook_endpoints.id, webhook_deliveries.webhookEndpointId),
		)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	return row
		? {
				delivery: row.delivery,
				endpoint: row.endpoint,
				eventType: row.eventType as SupportedWebhookEventType,
			}
		: null;
}

async function resolveEndpointSigningSecret({
	authSecret,
	endpoint,
}: {
	authSecret: string;
	endpoint: typeof webhook_endpoints.$inferSelect;
}): Promise<string | null> {
	if (!endpoint.signingSecretCiphertext) {
		return null;
	}

	try {
		return await decryptWebhookSigningSecret({
			ciphertext: endpoint.signingSecretCiphertext,
			secret: authSecret,
		});
	} catch {
		return null;
	}
}

const WEBHOOK_DELIVERY_TIMEOUT_MS = 15_000;
const WEBHOOK_FETCH_REJECTED_STATUS = 0;

const ALLOW_LOOPBACK_WEBHOOK_URLS = process.env.NODE_ENV !== "production";

async function sendWebhookDeliveryRequest({
	delivery,
	endpoint,
	eventType,
	signingSecret,
}: {
	delivery: typeof webhook_deliveries.$inferSelect;
	endpoint: typeof webhook_endpoints.$inferSelect;
	eventType: SupportedWebhookEventType;
	signingSecret: string;
}): Promise<Response> {
	// Re-validate at send time. Existing rows may predate the input schema, and
	// even after the schema rejects bad URLs at create / update we don't want a
	// future schema regression to silently start dispatching the signed payload
	// to a `javascript:` / `file:` / spoofed-IP target.
	const urlOutcome = parseSafeUrl(endpoint.url, {
		allowLoopback: ALLOW_LOOPBACK_WEBHOOK_URLS,
		mode: "webhook",
	});

	if (!urlOutcome.ok) {
		return new Response(
			JSON.stringify({
				error: {
					code: "WEBHOOK_URL_REJECTED",
					message: `Webhook endpoint URL is not acceptable: ${urlOutcome.reason}`,
				},
			}),
			{
				headers: { "Content-Type": "application/json" },
				status: WEBHOOK_FETCH_REJECTED_STATUS,
			},
		);
	}

	const signatureHeader = await createWebhookSignatureHeader({
		payload: delivery.payload ?? "",
		secret: signingSecret,
	});

	// Refuse to follow 3xx so a compromised or malicious endpoint can't
	// redirect the signed payload (X-Kayle-Signature) to an attacker host.
	// Cloudflare Workers does not implement `redirect: "error"` (workerd
	// throws TypeError up front), so we use `"manual"` and treat any 3xx
	// the endpoint returns as a failed delivery — `response.ok` is false
	// for 3xx, so `persistWebhookDeliveryAttemptResult` records it as
	// failed without ever following the redirect.
	return fetch(endpoint.url, {
		body: delivery.payload,
		headers: {
			"Content-Type": "application/jose",
			"X-Kayle-Delivery-Id": delivery.id,
			"X-Kayle-Event": eventType,
			"X-Kayle-Signature": signatureHeader,
		},
		method: "POST",
		redirect: "manual",
		// Bound delivery wall-clock so a slow endpoint can't park CF Workers
		// CPU/wall time and the retry pipeline can move on.
		signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
	});
}

async function persistWebhookDeliveryAttemptResult({
	attemptedAt,
	delivery,
	response,
}: {
	attemptedAt: Date;
	delivery: typeof webhook_deliveries.$inferSelect;
	response: Response;
}): Promise<void> {
	const nextAttemptCount = delivery.attemptCount + 1;

	await insertAttempt({
		deliveryId: delivery.id,
		status: response.ok ? "succeeded" : "failed",
		statusCode: response.status,
	});

	if (response.ok) {
		await db
			.update(webhook_deliveries)
			.set({
				attemptCount: nextAttemptCount,
				lastAttemptAt: attemptedAt,
				lastStatusCode: response.status,
				nextAttemptAt: null,
				status: "succeeded",
			})
			.where(eq(webhook_deliveries.id, delivery.id));

		return;
	}

	const nextAttemptAt = computeNextAttemptAt(nextAttemptCount);

	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: nextAttemptCount,
			lastAttemptAt: attemptedAt,
			lastStatusCode: response.status,
			nextAttemptAt,
			status: nextAttemptAt ? "pending" : "failed",
		})
		.where(eq(webhook_deliveries.id, delivery.id));
}

async function createWebhookDeliveriesForEvent({
	environment,
	eventId,
	eventType,
	organizationId,
	payload,
}: {
	environment: "live" | "test";
	eventId: string;
	eventType: SupportedWebhookEventType;
	organizationId: string;
	payload: WebhookPayload;
}): Promise<string[]> {
	const serializedPayload = JSON.stringify(payload);
	const candidateEndpoints = await db
		.select()
		.from(webhook_endpoints)
		.where(
			and(
				eq(webhook_endpoints.organizationId, organizationId),
				eq(webhook_endpoints.environment, environment),
				eq(webhook_endpoints.enabled, true),
			),
		);

	const subscribedEndpoints = candidateEndpoints.filter((endpoint) =>
		isSubscribedToEventType(endpoint.subscribedEventTypes, eventType),
	);

	if (subscribedEndpoints.length === 0) {
		return [];
	}

	const encryptionKeys = await db
		.select()
		.from(webhook_encryption_keys)
		.where(
			and(
				eq(webhook_encryption_keys.isActive, true),
				inArray(
					webhook_encryption_keys.webhookEndpointId,
					subscribedEndpoints.map((endpoint) => endpoint.id),
				),
			),
		);

	const keysByEndpointId = indexBy(encryptionKeys, "webhookEndpointId");
	const createdDeliveryIds: string[] = [];

	for (const endpoint of subscribedEndpoints) {
		const key = keysByEndpointId.get(endpoint.id) ?? null;
		const deliveryId = generateId({
			type: "whd",
			environment: endpoint.environment,
		});
		createdDeliveryIds.push(deliveryId);

		if (!key) {
			await db.insert(webhook_deliveries).values({
				id: deliveryId,
				attemptCount: 1,
				eventId,
				lastAttemptAt: new Date(),
				nextAttemptAt: null,
				payload: null,
				status: "failed",
				webhookEndpointId: endpoint.id,
				webhookEncryptionKeyId: null,
			});
			await insertAttempt({
				deliveryId,
				status: "failed",
				statusCode: null,
			});
			continue;
		}

		try {
			const encryptedPayload = await createJWE(serializedPayload, {
				algorithm: "RSA-OAEP-256",
				keyId: key.keyId,
				publicJwk: key.jwk as Record<string, unknown>,
			});

			await db.insert(webhook_deliveries).values({
				eventId,
				id: deliveryId,
				payload: encryptedPayload,
				status: "pending",
				webhookEndpointId: endpoint.id,
				webhookEncryptionKeyId: key.id,
			});
		} catch {
			await db.insert(webhook_deliveries).values({
				id: deliveryId,
				attemptCount: 1,
				eventId,
				lastAttemptAt: new Date(),
				nextAttemptAt: null,
				payload: null,
				status: "failed",
				webhookEndpointId: endpoint.id,
				webhookEncryptionKeyId: key.id,
			});
			await insertAttempt({
				deliveryId,
				status: "failed",
				statusCode: null,
			});
		}
	}
	return createdDeliveryIds;
}

export function createWebhookDeliveriesForVerificationSucceeded({
	attemptId,
	environment,
	eventId,
	manifest,
	organizationId,
}: {
	attemptId: string;
	environment: "live" | "test";
	eventId: string;
	manifest: VerifyShareManifest;
	organizationId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
		environment,
		eventId,
		eventType: "verification.attempt.succeeded",
		organizationId,
		payload: buildVerificationSucceededPayload({
			attemptId,
			eventId,
			manifest,
		}),
	});
}

export function createWebhookDeliveriesForVerificationAttemptFailed({
	attemptId,
	contractVersion,
	environment,
	eventId,
	failureCode,
	organizationId,
	sessionId,
}: {
	attemptId: string;
	contractVersion: number;
	environment: "live" | "test";
	eventId: string;
	failureCode: VerificationAttemptFailedCode;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
		environment,
		eventId,
		eventType: "verification.attempt.failed",
		organizationId,
		payload: buildVerificationAttemptFailedPayload({
			attemptId,
			contractVersion,
			eventId,
			failureCode,
			sessionId,
		}),
	});
}

export function createWebhookDeliveriesForVerificationSessionExpired({
	contractVersion,
	environment,
	eventId,
	organizationId,
	sessionId,
}: {
	contractVersion: number;
	environment: "live" | "test";
	eventId: string;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
		environment,
		eventId,
		eventType: "verification.session.expired",
		organizationId,
		payload: buildVerificationSessionExpiredPayload({
			contractVersion,
			eventId,
			sessionId,
		}),
	});
}

export function createWebhookDeliveriesForVerificationSessionCancelled({
	contractVersion,
	environment,
	eventId,
	organizationId,
	sessionId,
}: {
	contractVersion: number;
	environment: "live" | "test";
	eventId: string;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
		environment,
		eventId,
		eventType: "verification.session.cancelled",
		organizationId,
		payload: buildVerificationSessionCancelledPayload({
			contractVersion,
			eventId,
			sessionId,
		}),
	});
}

export async function attemptWebhookDelivery({
	authSecret,
	deliveryId,
}: {
	authSecret: string;
	deliveryId: string;
}): Promise<DeliveryRowResponse | null> {
	const context = await getDeliveryAttemptContext(deliveryId);

	if (!context) {
		return null;
	}

	if (!(context.endpoint.enabled && context.delivery.payload)) {
		return markWebhookDeliveryFailedAndReload(deliveryId);
	}

	const signingSecret = await resolveEndpointSigningSecret({
		authSecret,
		endpoint: context.endpoint,
	});

	if (!signingSecret) {
		return markWebhookDeliveryFailedAndReload(deliveryId);
	}

	const now = new Date();
	await db
		.update(webhook_deliveries)
		.set({
			status: "delivering",
		})
		.where(eq(webhook_deliveries.id, deliveryId));

	try {
		const response = await sendWebhookDeliveryRequest({
			delivery: context.delivery,
			endpoint: context.endpoint,
			eventType: context.eventType,
			signingSecret,
		});
		await persistWebhookDeliveryAttemptResult({
			attemptedAt: now,
			delivery: context.delivery,
			response,
		});
	} catch (error) {
		// The DB row only records `status_code = NULL` for thrown deliveries,
		// which makes silent fetch errors (e.g. workerd rejecting an unsupported
		// option) impossible to diagnose from the table alone. Emit through the
		// structured logger so the next regression here is visible in the same
		// log pipeline as the rest of the worker.
		const logger = createSafeRequestLogger({
			headers: new Headers(),
			method: "POST",
			path: "/internal/webhook-delivery",
		});
		logSafeError(logger, {
			code: "webhook_delivery_attempt_threw",
			details: {
				delivery_id: deliveryId,
				endpoint_url: context.endpoint.url,
			},
			error,
			event: "webhooks.delivery.attempt_threw",
			message: "Webhook delivery attempt threw before persisting a result.",
		});
		logger.emit({ _forceKeep: true });
		return markWebhookDeliveryFailedAndReload(deliveryId);
	}

	return getMappedWebhookDelivery(deliveryId);
}

export async function processDueWebhookDeliveries({
	authSecret,
	limit = 20,
}: {
	authSecret: string;
	limit?: number;
}): Promise<DeliveryRowResponse[]> {
	// Skip deliveries belonging to orgs that are scheduled for deletion. The
	// deliveries themselves are FK-cascaded once the org is hard-deleted, so
	// they don't need to be cleaned up here — just paused.
	const dueRows = await db
		.select({ delivery: webhook_deliveries })
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.innerJoin(
			auth_organizations,
			eq(auth_organizations.id, events.organizationId),
		)
		.where(
			and(
				eq(webhook_deliveries.status, "pending"),
				or(
					isNull(webhook_deliveries.nextAttemptAt),
					lte(webhook_deliveries.nextAttemptAt, new Date()),
				),
				isNull(auth_organizations.pendingDeletionAt),
			),
		)
		.orderBy(asc(webhook_deliveries.createdAt))
		.limit(limit);

	const dueDeliveries = dueRows.map((row) => row.delivery);

	const processed: DeliveryRowResponse[] = [];

	for (const delivery of dueDeliveries) {
		const result = await attemptWebhookDelivery({
			authSecret,
			deliveryId: delivery.id,
		});

		if (result) {
			processed.push(result);
		}
	}

	return processed;
}

export async function getWebhookDeliveryForOrganization({
	deliveryId,
	organizationId,
}: {
	deliveryId: string;
	organizationId: string;
}): Promise<typeof webhook_deliveries.$inferSelect | null> {
	const [row] = await db
		.select({
			delivery: webhook_deliveries,
		})
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				eq(events.organizationId, organizationId),
			),
		)
		.limit(1);

	return row?.delivery ?? null;
}

export async function requeueWebhookDelivery({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<typeof webhook_deliveries.$inferSelect | null> {
	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: 0,
			lastAttemptAt: null,
			lastStatusCode: null,
			nextAttemptAt: null,
			status: "pending",
		})
		.where(eq(webhook_deliveries.id, deliveryId));

	const [updated] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	return updated ?? null;
}

export async function requeueWebhookDeliveriesForEvent({
	eventId,
}: {
	eventId: string;
}): Promise<(typeof webhook_deliveries.$inferSelect)[]> {
	const deliveries = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.eventId, eventId));

	const requeued: (typeof webhook_deliveries.$inferSelect)[] = [];

	for (const delivery of deliveries) {
		const nextDelivery = await requeueWebhookDelivery({
			deliveryId: delivery.id,
		});

		if (nextDelivery) {
			requeued.push(nextDelivery);
		}
	}

	return requeued;
}

export { mapWebhookDeliveryRowToResponse };
