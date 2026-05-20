import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import { indexBy } from "@kayle-id/config/collections";
import {
	createSafeRequestLogger,
	logEvent,
	logSafeError,
} from "@kayle-id/config/logging";
import { parseSafeUrl } from "@kayle-id/config/safe-url";
import type { SupportedWebhookEventType } from "@kayle-id/config/webhook-events";
import { MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import { events, verification_sessions } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_delivery_attempts,
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	or,
} from "drizzle-orm";
import { config } from "@/config";
import { createJWE } from "@/functions/jwe";
import { generateId } from "@/utils/generate-id";
import type { VerifyShareManifest } from "@/v1/verify/share-manifest";
import {
	createWebhookSignatureHeader,
	decryptWebhookSigningSecret,
} from "@/v1/webhooks/signing-secret";
import {
	buildVerificationSessionCancelledPayload,
	buildVerificationSessionExpiredPayload,
	buildVerificationSessionFailedPayload,
	buildVerificationSessionSucceededPayload,
} from "./payloads";
import type {
	DeliveryRowResponse,
	VerificationSessionFailedCode,
	WebhookPayload,
} from "./types";
import {
	WEBHOOK_AUTOMATIC_RETRY_WINDOW_MS,
	WEBHOOK_PAYLOAD_EXPIRED_ERROR_CODE,
} from "./types";

const HOUR_MS = 60 * 60_000;
const WEBHOOK_PAYLOAD_RETENTION_SWEEP_BATCH_SIZE = 500;

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
		payload_expires_at: row.payloadExpiresAt?.toISOString() ?? null,
		payload_retention_reason: row.payloadRetentionReason,
		payload_scrubbed_at: row.payloadScrubbedAt?.toISOString() ?? null,
		status: row.status,
		updated_at: row.updatedAt.toISOString(),
		webhook_encryption_key_id: row.webhookEncryptionKeyId,
		webhook_endpoint_id: row.webhookEndpointId,
	};
}

function addHours(date: Date, hours: number): Date {
	return new Date(date.getTime() + hours * HOUR_MS);
}

function getPendingPayloadExpiry({
	retentionHours,
	now,
}: {
	retentionHours: number;
	now: Date;
}): Date {
	const boundedRetentionHours = Math.min(
		Math.max(retentionHours, 0),
		MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
	);
	return new Date(
		now.getTime() +
			WEBHOOK_AUTOMATIC_RETRY_WINDOW_MS +
			boundedRetentionHours * HOUR_MS,
	);
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

async function getWebhookEndpointTargetIdsForSession(
	sessionId: string,
): Promise<string[] | null> {
	const [session] = await db
		.select({
			webhookEndpointIds: verification_sessions.webhookEndpointIds,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	return session?.webhookEndpointIds?.length
		? session.webhookEndpointIds
		: null;
}

type DeliveryAttemptContext = {
	delivery: typeof webhook_deliveries.$inferSelect;
	endpoint: typeof webhook_endpoints.$inferSelect;
	event: {
		triggerId: string;
		triggerType: string;
		type: SupportedWebhookEventType;
	};
};

async function getDeliveryAttemptContext(
	deliveryId: string,
): Promise<DeliveryAttemptContext | null> {
	const [row] = await db
		.select({
			delivery: webhook_deliveries,
			endpoint: webhook_endpoints,
			eventTriggerId: events.triggerId,
			eventTriggerType: events.triggerType,
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
				event: {
					triggerId: row.eventTriggerId,
					triggerType: row.eventTriggerType,
					type: row.eventType as SupportedWebhookEventType,
				},
			}
		: null;
}

async function getSessionPrivacyStateForDeliveryEvent({
	triggerId,
	triggerType,
}: DeliveryAttemptContext["event"]): Promise<{
	cancelTokenConsumedAt: Date | null;
	status: string;
} | null> {
	if (triggerType !== "verification_session") {
		return null;
	}

	const [row] = await db
		.select({
			cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
			status: verification_sessions.status,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, triggerId))
		.limit(1);

	return row ?? null;
}

async function cancelWebhookDeliveryAfterPrivacyWithdrawal({
	deliveryId,
	event,
	now = new Date(),
}: {
	deliveryId: string;
	event: DeliveryAttemptContext["event"];
	now?: Date;
}): Promise<boolean> {
	if (event.type === "verification.session.cancelled") {
		return false;
	}

	const session = await getSessionPrivacyStateForDeliveryEvent(event);
	const isWithdrawn = Boolean(
		session?.cancelTokenConsumedAt || session?.status === "cancelled",
	);

	if (!isWithdrawn) {
		return false;
	}

	await db
		.update(webhook_deliveries)
		.set({
			nextAttemptAt: null,
			payload: null,
			payloadExpiresAt: null,
			payloadRetentionReason: "privacy_request",
			payloadScrubbedAt: now,
			status: "failed",
		})
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				ne(webhook_deliveries.status, "succeeded"),
			),
		);

	return true;
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
				isNotNull(webhook_deliveries.payload),
				or(
					isNull(webhook_deliveries.payloadRetentionReason),
					ne(webhook_deliveries.payloadRetentionReason, "privacy_request"),
				),
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
			payload: response.ok ? null : delivery.payload,
			payloadExpiresAt: response.ok ? null : delivery.payloadExpiresAt,
			payloadRetentionReason: response.ok ? "delivered" : "pending_delivery",
			payloadScrubbedAt: response.ok ? attemptedAt : delivery.payloadScrubbedAt,
			status: response.ok ? "succeeded" : "pending",
		})
		.where(
			and(
				eq(webhook_deliveries.id, delivery.id),
				eq(webhook_deliveries.status, "delivering"),
			),
		);
}

async function recordPreflightFailure({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<void> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	if (!delivery?.payload) {
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
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				eq(webhook_deliveries.status, "delivering"),
			),
		);
}

async function createWebhookDeliveriesForEvent({
	eventId,
	eventType,
	organizationId,
	payload,
	webhookEndpointIds,
}: {
	eventId: string;
	eventType: SupportedWebhookEventType;
	organizationId: string;
	payload: WebhookPayload;
	webhookEndpointIds?: string[] | null;
}): Promise<string[]> {
	const serializedPayload = JSON.stringify(payload);
	const targetEndpointIds = webhookEndpointIds?.length
		? webhookEndpointIds
		: null;
	const candidateEndpoints = await db
		.select()
		.from(webhook_endpoints)
		.where(
			and(
				eq(webhook_endpoints.organizationId, organizationId),
				eq(webhook_endpoints.enabled, true),
				...(targetEndpointIds
					? [inArray(webhook_endpoints.id, targetEndpointIds)]
					: []),
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
		const now = new Date();
		const payloadExpiresAt = getPendingPayloadExpiry({
			now,
			retentionHours: endpoint.undeliveredPayloadRetentionHours,
		});

		if (!key) {
			await db.insert(webhook_deliveries).values({
				id: deliveryId,
				attemptCount: 1,
				eventId,
				lastAttemptAt: now,
				nextAttemptAt: null,
				payload: null,
				payloadRetentionReason: "no_active_key",
				payloadScrubbedAt: now,
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
				payloadExpiresAt,
				payloadRetentionReason: "pending_delivery",
				status: "pending",
				webhookEndpointId: endpoint.id,
				webhookEncryptionKeyId: key.id,
			});
		} catch {
			await db.insert(webhook_deliveries).values({
				id: deliveryId,
				attemptCount: 1,
				eventId,
				lastAttemptAt: now,
				nextAttemptAt: null,
				payload: null,
				payloadRetentionReason: "jwe_creation_failed",
				payloadScrubbedAt: now,
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

export async function createWebhookDeliveriesForVerificationSessionSucceededWithManifest({
	eventId,
	manifest,
	organizationId,
}: {
	eventId: string;
	manifest: VerifyShareManifest;
	organizationId: string;
}): Promise<string[]> {
	const [session] = await db
		.select({
			cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
			status: verification_sessions.status,
			webhookEndpointIds: verification_sessions.webhookEndpointIds,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, manifest.sessionId))
		.limit(1);

	if (session?.cancelTokenConsumedAt || session?.status === "cancelled") {
		return [];
	}

	return createWebhookDeliveriesForEvent({
		eventId,
		eventType: "verification.session.succeeded",
		organizationId,
		payload: buildVerificationSessionSucceededPayload({
			eventId,
			manifest,
		}),
		webhookEndpointIds: session?.webhookEndpointIds ?? null,
	});
}

/**
 * Stub used by `markSessionSucceeded` when the share manifest is not available
 * at the call site (e.g. age-only flows). Real claim payloads come from the
 * shareSelection success path which uses the manifest variant above.
 */
export async function createWebhookDeliveriesForVerificationSessionSucceeded(_input: {
	contractVersion: number;
	eventId: string;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	// markSessionSucceeded does not build the claim payload — that happens in the
	// shareSelection completion path via the manifest-aware variant. This stub
	// exists so callers can ignore the manifest plumbing and return an empty list
	// when no follow-up is needed.
	return [];
}

export type WebhookPayloadPrivacyScrubResult = {
	deliveredDeliveryCount: number;
	scrubbedDeliveryCount: number;
	totalDeliveryCount: number;
};

export async function scrubWebhookPayloadsForVerificationSessionPrivacyRequest({
	now = new Date(),
	organizationId,
	sessionId,
}: {
	now?: Date;
	organizationId: string;
	sessionId: string;
}): Promise<WebhookPayloadPrivacyScrubResult> {
	const eventRows = await db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				eq(events.organizationId, organizationId),
				eq(events.triggerId, sessionId),
			),
		);

	if (eventRows.length === 0) {
		return {
			deliveredDeliveryCount: 0,
			scrubbedDeliveryCount: 0,
			totalDeliveryCount: 0,
		};
	}

	const deliveryRows = await db
		.select({
			id: webhook_deliveries.id,
			payload: webhook_deliveries.payload,
			status: webhook_deliveries.status,
		})
		.from(webhook_deliveries)
		.where(
			inArray(
				webhook_deliveries.eventId,
				eventRows.map((event) => event.id),
			),
		);
	const scrubbedDeliveryIds = deliveryRows
		.filter((delivery) => delivery.status !== "succeeded" && delivery.payload)
		.map((delivery) => delivery.id);

	if (scrubbedDeliveryIds.length > 0) {
		await db
			.update(webhook_deliveries)
			.set({
				nextAttemptAt: null,
				payload: null,
				payloadExpiresAt: null,
				payloadRetentionReason: "privacy_request",
				payloadScrubbedAt: now,
				status: "failed",
			})
			.where(inArray(webhook_deliveries.id, scrubbedDeliveryIds));
	}

	return {
		deliveredDeliveryCount: deliveryRows.filter(
			(delivery) => delivery.status === "succeeded",
		).length,
		scrubbedDeliveryCount: scrubbedDeliveryIds.length,
		totalDeliveryCount: deliveryRows.length,
	};
}

export async function createWebhookDeliveriesForVerificationSessionFailed({
	contractVersion,
	eventId,
	failureCode,
	nfcTriesUsed,
	livenessTriesUsed,
	organizationId,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	failureCode: VerificationSessionFailedCode;
	nfcTriesUsed: number;
	livenessTriesUsed: number;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	const webhookEndpointIds =
		await getWebhookEndpointTargetIdsForSession(sessionId);

	return createWebhookDeliveriesForEvent({
		eventId,
		eventType: "verification.session.failed",
		organizationId,
		payload: buildVerificationSessionFailedPayload({
			contractVersion,
			eventId,
			failureCode,
			nfcTriesUsed,
			livenessTriesUsed,
			sessionId,
		}),
		webhookEndpointIds,
	});
}

export async function createWebhookDeliveriesForVerificationSessionExpired({
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
	const webhookEndpointIds =
		await getWebhookEndpointTargetIdsForSession(sessionId);

	return createWebhookDeliveriesForEvent({
		eventId,
		eventType: "verification.session.expired",
		organizationId,
		payload: buildVerificationSessionExpiredPayload({
			contractVersion,
			eventId,
			sessionId,
		}),
		webhookEndpointIds,
	});
}

export async function createWebhookDeliveriesForVerificationSessionCancelled({
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
	const webhookEndpointIds =
		await getWebhookEndpointTargetIdsForSession(sessionId);

	return createWebhookDeliveriesForEvent({
		eventId,
		eventType: "verification.session.cancelled",
		organizationId,
		payload: buildVerificationSessionCancelledPayload({
			contractVersion,
			eventId,
			sessionId,
		}),
		webhookEndpointIds,
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

	if (
		await cancelWebhookDeliveryAfterPrivacyWithdrawal({
			deliveryId,
			event: context.event,
		})
	) {
		return;
	}

	const claimedDelivery = await claimPendingWebhookDelivery(deliveryId);
	if (!claimedDelivery) {
		const currentDelivery = await getWebhookDeliveryById(deliveryId);
		if (
			!currentDelivery?.payload ||
			currentDelivery.payloadRetentionReason === "privacy_request"
		) {
			return;
		}

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

	if (
		await cancelWebhookDeliveryAfterPrivacyWithdrawal({
			deliveryId,
			event: context.event,
		})
	) {
		return;
	}

	const latestClaimedDelivery = await getWebhookDeliveryById(deliveryId);
	if (
		latestClaimedDelivery?.status !== "delivering" ||
		!latestClaimedDelivery.payload ||
		latestClaimedDelivery.payloadRetentionReason === "privacy_request"
	) {
		return;
	}

	if (!context.endpoint.enabled) {
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

	if (
		await cancelWebhookDeliveryAfterPrivacyWithdrawal({
			deliveryId,
			event: context.event,
		})
	) {
		return;
	}

	const deliveryBeforeSend = await getWebhookDeliveryById(deliveryId);
	if (
		deliveryBeforeSend?.status !== "delivering" ||
		!deliveryBeforeSend.payload ||
		deliveryBeforeSend.payloadRetentionReason === "privacy_request"
	) {
		return;
	}

	const now = new Date();

	let response: Response;
	try {
		response = await sendWebhookDeliveryRequest({
			delivery: deliveryBeforeSend,
			endpoint: context.endpoint,
			eventType: context.event.type,
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
		delivery: deliveryBeforeSend,
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
	const context = await getDeliveryAttemptContext(deliveryId);
	const delivery =
		context?.delivery ?? (await getWebhookDeliveryById(deliveryId));

	if (!delivery) {
		return;
	}

	if (delivery.status === "succeeded" || delivery.status === "failed") {
		return;
	}

	const terminalFailureAt = new Date();
	const retentionHours =
		context?.endpoint.undeliveredPayloadRetentionHours ??
		MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS;
	const payloadExpiresAt = addHours(terminalFailureAt, retentionHours);
	const shouldScrubImmediately =
		delivery.payload === null || retentionHours === 0;

	await db
		.update(webhook_deliveries)
		.set({
			nextAttemptAt: null,
			payload: shouldScrubImmediately ? null : delivery.payload,
			payloadExpiresAt: shouldScrubImmediately ? null : payloadExpiresAt,
			payloadRetentionReason: shouldScrubImmediately
				? "expired"
				: "terminal_failure_retention",
			payloadScrubbedAt: shouldScrubImmediately ? terminalFailureAt : null,
			status: "failed",
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

export type WebhookDeliveryRetryBlockReason =
	| "delivering"
	| "payload_expired"
	| "payload_scrubbed";

export function getWebhookDeliveryRetryBlockReason(
	delivery: typeof webhook_deliveries.$inferSelect,
	now = new Date(),
): WebhookDeliveryRetryBlockReason | null {
	if (delivery.status === "delivering") {
		return "delivering";
	}

	if (!delivery.payload) {
		return "payload_scrubbed";
	}

	if (!delivery.payloadExpiresAt || delivery.payloadExpiresAt <= now) {
		return "payload_expired";
	}

	return null;
}

export function getWebhookPayloadExpiredErrorResponse() {
	return {
		code: WEBHOOK_PAYLOAD_EXPIRED_ERROR_CODE,
		message: "Webhook payload is no longer retained.",
		hint: "Payload expired; create a new verification session or handle the event manually.",
		docs: "https://kayle.id/docs/api/webhooks/deliveries#payload-retention",
	};
}

export async function requeueWebhookDelivery({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<typeof webhook_deliveries.$inferSelect | null> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	if (!delivery || getWebhookDeliveryRetryBlockReason(delivery) !== null) {
		return null;
	}

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
				isNotNull(webhook_deliveries.payload),
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

export type WebhookPayloadRetentionSweepResult = {
	failed: boolean;
	orgCount: number;
	scrubbedCount: number;
};

function getWebhookPayloadSweepAgeBucket({
	expiresAt,
	now,
}: {
	expiresAt: Date;
	now: Date;
}): "lt_1h" | "lt_24h" | "gte_24h" {
	const overdueMs = Math.max(now.getTime() - expiresAt.getTime(), 0);

	if (overdueMs < HOUR_MS) {
		return "lt_1h";
	}

	if (overdueMs < 24 * HOUR_MS) {
		return "lt_24h";
	}

	return "gte_24h";
}

export async function runWebhookPayloadRetentionSweep({
	batchSize = WEBHOOK_PAYLOAD_RETENTION_SWEEP_BATCH_SIZE,
	now,
}: {
	batchSize?: number;
	now: Date;
}): Promise<WebhookPayloadRetentionSweepResult> {
	const logger = createSafeRequestLogger({
		headers: new Headers(),
		method: "SCHEDULED",
		path: "/internal/webhook-payload-retention-sweep",
	});

	try {
		const expiredRows = await db
			.select({
				deliveryId: webhook_deliveries.id,
				expiresAt: webhook_deliveries.payloadExpiresAt,
				organizationId: events.organizationId,
			})
			.from(webhook_deliveries)
			.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
			.where(
				and(
					isNotNull(webhook_deliveries.payload),
					isNotNull(webhook_deliveries.payloadExpiresAt),
					lte(webhook_deliveries.payloadExpiresAt, now),
				),
			)
			.orderBy(asc(webhook_deliveries.payloadExpiresAt))
			.limit(batchSize);

		if (expiredRows.length === 0) {
			logEvent(logger, {
				details: {
					age_bucket_gte_24h: 0,
					age_bucket_lt_1h: 0,
					age_bucket_lt_24h: 0,
					org_count: 0,
					scrubbed_count: 0,
				},
				event: "webhooks.payload_retention_sweep.completed",
			});
			logger.emit({ _forceKeep: false });
			return { failed: false, orgCount: 0, scrubbedCount: 0 };
		}

		const ageBuckets = {
			lt_1h: 0,
			lt_24h: 0,
			gte_24h: 0,
		};
		const organizationIds = new Set<string>();
		const deliveryIds: string[] = [];

		for (const row of expiredRows) {
			if (!row.expiresAt) {
				continue;
			}

			deliveryIds.push(row.deliveryId);
			organizationIds.add(row.organizationId);
			ageBuckets[
				getWebhookPayloadSweepAgeBucket({ expiresAt: row.expiresAt, now })
			] += 1;
		}

		if (deliveryIds.length > 0) {
			await db
				.update(webhook_deliveries)
				.set({
					payload: null,
					payloadExpiresAt: null,
					payloadRetentionReason: "expired",
					payloadScrubbedAt: now,
				})
				.where(inArray(webhook_deliveries.id, deliveryIds));
		}

		logEvent(logger, {
			details: {
				age_bucket_gte_24h: ageBuckets.gte_24h,
				age_bucket_lt_1h: ageBuckets.lt_1h,
				age_bucket_lt_24h: ageBuckets.lt_24h,
				org_count: organizationIds.size,
				scrubbed_count: deliveryIds.length,
			},
			event: "webhooks.payload_retention_sweep.completed",
		});
		logger.emit({ _forceKeep: deliveryIds.length > 0 });

		return {
			failed: false,
			orgCount: organizationIds.size,
			scrubbedCount: deliveryIds.length,
		};
	} catch (error) {
		logSafeError(logger, {
			code: "webhook_payload_retention_sweep_failed",
			error,
			event: "webhooks.payload_retention_sweep.failed",
			message: "Webhook payload retention sweep failed.",
		});
		logger.emit({ _forceKeep: true });

		return { failed: true, orgCount: 0, scrubbedCount: 0 };
	}
}

export { mapWebhookDeliveryRowToResponse };
