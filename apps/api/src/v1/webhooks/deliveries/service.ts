import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import { indexBy } from "@kayle-id/config/collections";
import {
	createSafeRequestLogger,
	logSafeError,
} from "@kayle-id/config/logging";
import { parseSafeUrl } from "@kayle-id/config/safe-url";
import type { SupportedWebhookEventType } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_delivery_attempts,
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { and, eq, inArray, ne } from "drizzle-orm";
import { config } from "@/config";
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
import type {
	DeliveryRowResponse,
	VerificationAttemptFailedCode,
	WebhookPayload,
} from "./types";

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
	await db.insert(webhook_delivery_attempts).values({
		id: generateId({
			type: "wha",
		}),
		status,
		statusCode,
		webhookDeliveryId: deliveryId,
	});
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

async function claimPendingWebhookDelivery(
	deliveryId: string,
): Promise<typeof webhook_deliveries.$inferSelect | null> {
	const [claimed] = await db
		.update(webhook_deliveries)
		.set({
			status: "delivering",
		})
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				eq(webhook_deliveries.status, "pending"),
			),
		)
		.returning();

	return claimed ?? null;
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
const WEBHOOK_FETCH_REJECTED_STATUS = 400;

const ALLOW_LOOPBACK_WEBHOOK_URLS = process.env.NODE_ENV !== "production";

export function getWebhookEndpointLogTarget(endpointUrl: string): string {
	try {
		return new URL(endpointUrl).origin;
	} catch {
		return "invalid_webhook_url";
	}
}

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
	return fetch(urlOutcome.url.toString(), {
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

	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: nextAttemptCount,
			lastAttemptAt: attemptedAt,
			lastStatusCode: response.status,
			// Cloudflare Workflows owns retry scheduling now; keep this field
			// nulled out so nothing else interprets it as a queue cursor.
			nextAttemptAt: null,
			status: response.ok ? "succeeded" : "pending",
		})
		.where(eq(webhook_deliveries.id, delivery.id));
}

async function recordPreflightFailure({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<void> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	if (!delivery) {
		return;
	}

	const nextAttemptCount = delivery.attemptCount + 1;

	await insertAttempt({
		deliveryId,
		status: "failed",
		statusCode: null,
	});

	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: nextAttemptCount,
			lastAttemptAt: new Date(),
			lastStatusCode: null,
			nextAttemptAt: null,
			status: "pending",
		})
		.where(eq(webhook_deliveries.id, deliveryId));
}

async function createWebhookDeliveriesForEvent({
	eventId,
	eventType,
	organizationId,
	payload,
}: {
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
	eventId,
	manifest,
	organizationId,
}: {
	attemptId: string;
	eventId: string;
	manifest: VerifyShareManifest;
	organizationId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
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
	eventId,
	failureCode,
	organizationId,
	sessionId,
}: {
	attemptId: string;
	contractVersion: number;
	eventId: string;
	failureCode: VerificationAttemptFailedCode;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
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
	eventId,
	organizationId,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
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
	eventId,
	organizationId,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createWebhookDeliveriesForEvent({
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

class WebhookDeliveryAttemptError extends Error {
	readonly statusCode: number | null;

	constructor(message: string, statusCode: number | null) {
		super(message);
		this.name = "WebhookDeliveryAttemptError";
		this.statusCode = statusCode;
	}
}

/**
 * Run a single webhook delivery attempt. Persists the attempt and updates the
 * delivery row, then either resolves on success or throws on failure so the
 * Cloudflare Workflow step retry policy can drive exponential backoff.
 */
export async function runWebhookDeliveryAttempt({
	authSecret,
	deliveryId,
}: {
	authSecret: string;
	deliveryId: string;
}): Promise<void> {
	const context = await getDeliveryAttemptContext(deliveryId);

	if (!context) {
		// The row was deleted (e.g. org hard-delete cascade). Nothing to do —
		// resolve so the workflow ends cleanly without a retry.
		return;
	}

	const claimedDelivery = await claimPendingWebhookDelivery(deliveryId);
	if (!claimedDelivery) {
		const currentDelivery = await getWebhookDeliveryById(deliveryId);
		if (
			currentDelivery?.status === "pending" ||
			currentDelivery?.status === "delivering"
		) {
			throw new WebhookDeliveryAttemptError(
				"webhook_delivery_claim_unavailable",
				null,
			);
		}

		// Stale invocation for a succeeded/terminal delivery. Do not resend.
		return;
	}

	if (!(context.endpoint.enabled && claimedDelivery.payload)) {
		await recordPreflightFailure({ deliveryId });
		throw new WebhookDeliveryAttemptError(
			"webhook_delivery_endpoint_disabled_or_payload_missing",
			null,
		);
	}

	const signingSecret = await resolveEndpointSigningSecret({
		authSecret,
		endpoint: context.endpoint,
	});

	if (!signingSecret) {
		await recordPreflightFailure({ deliveryId });
		throw new WebhookDeliveryAttemptError(
			"webhook_delivery_signing_secret_unavailable",
			null,
		);
	}

	const now = new Date();

	let response: Response;
	try {
		response = await sendWebhookDeliveryRequest({
			delivery: claimedDelivery,
			endpoint: context.endpoint,
			eventType: context.eventType,
			signingSecret,
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
				endpoint_url: getWebhookEndpointLogTarget(context.endpoint.url),
			},
			error,
			event: "webhooks.delivery.attempt_threw",
			message: "Webhook delivery attempt threw before persisting a result.",
		});
		logger.emit({ _forceKeep: true });
		await recordPreflightFailure({ deliveryId });
		throw error instanceof Error
			? error
			: new WebhookDeliveryAttemptError("webhook_delivery_threw", null);
	}

	await persistWebhookDeliveryAttemptResult({
		attemptedAt: now,
		delivery: claimedDelivery,
		response,
	});

	if (!response.ok) {
		throw new WebhookDeliveryAttemptError(
			`webhook_delivery_failed_${response.status}`,
			response.status,
		);
	}
}

/**
 * Mark a delivery as terminally failed. Called by the Workflow after retries
 * are exhausted. Idempotent: succeeded deliveries are left alone.
 */
export async function finalizeWebhookDeliveryFailure({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<void> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	if (!delivery) {
		return;
	}

	if (delivery.status === "succeeded" || delivery.status === "failed") {
		return;
	}

	await db
		.update(webhook_deliveries)
		.set({
			status: "failed",
			nextAttemptAt: null,
		})
		.where(eq(webhook_deliveries.id, deliveryId));
}

/**
 * Convenience wrapper used by the API retry endpoint and tests. Runs a single
 * attempt without throwing on a failed HTTP response — the row state already
 * captures the outcome — and returns the post-attempt row for the response.
 */
export async function attemptWebhookDelivery({
	authSecret,
	deliveryId,
}: {
	authSecret: string;
	deliveryId: string;
}): Promise<DeliveryRowResponse | null> {
	try {
		await runWebhookDeliveryAttempt({ authSecret, deliveryId });
	} catch {
		// The row already records the failure; the caller asks for the row.
	}
	return getMappedWebhookDelivery(deliveryId);
}

type WebhookWorkflowEnv = {
	WEBHOOK_DELIVERY_WORKFLOW?: Workflow<{ deliveryId: string }>;
};

/**
 * Trigger one Workflow instance per delivery so the Workflow runtime drives
 * exponential-backoff retries. Safe to call from environments without the
 * binding (e.g. unit tests) — it no-ops when the binding is absent.
 */
export async function triggerWebhookDeliveryWorkflows({
	env,
	deliveryIds,
}: {
	env: WebhookWorkflowEnv | undefined;
	deliveryIds: readonly string[];
}): Promise<void> {
	if (deliveryIds.length === 0) {
		return;
	}

	const binding = env?.WEBHOOK_DELIVERY_WORKFLOW;
	if (!binding) {
		return;
	}

	await binding.createBatch(
		deliveryIds.map((deliveryId) => ({
			params: { deliveryId },
		})),
	);

	// Cost attribution: one workflow_run event per delivery. Triggers
	// retries automatically via the Workflow runtime, but each retry
	// re-bills as a separate workflow run on CF's side — those would
	// emit from inside the Workflow body, not here.
	emitCostEvent({
		dataset: resolveAnalyticsDataset(env),
		feature: COST_FEATURES.WebhookDelivery,
		resource: "workflow_run",
		quantity: deliveryIds.length,
		unit: "request",
		workerName: "kayle-id-api",
		environment: config.environment ?? "unknown",
		version: config.version,
	});
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
	const [updated] = await db
		.update(webhook_deliveries)
		.set({
			attemptCount: 0,
			lastAttemptAt: null,
			lastStatusCode: null,
			nextAttemptAt: null,
			status: "pending",
		})
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				ne(webhook_deliveries.status, "delivering"),
			),
		)
		.returning();

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
