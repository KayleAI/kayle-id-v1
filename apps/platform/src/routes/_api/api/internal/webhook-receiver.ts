import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import {
	isRequestBodyTooLarge,
	readRequestTextWithLimit,
} from "@kayle-id/config/request-body";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { APP_ENVIRONMENT, APP_VERSION } from "@/config/version";
import { decryptCompactJwe, verifyWebhookSignature } from "@/demo/crypto";

const SIGNATURE_HEADER = "x-kayle-signature";
const PLATFORM_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;
const KV_PREFIX = "org-verify:";
const PLATFORM_WORKER_NAME = "kayle-id-platform";

interface WebhookEnvelope {
	type?: string;
	data?: {
		claims?: Record<string, unknown>;
	};
	metadata?: {
		verification_session_id?: string;
	};
}

interface OrgVerificationMapping {
	organization_id: string;
	owner_user_id: string;
}

type ApiDocumentType =
	| "passport"
	| "national_id"
	| "residence_permit"
	| "other";

/**
 * Mirrors `mapMrzDocumentTypeToEnum` on the API. Kept here as a small copy to
 * avoid pulling API code into the platform worker — the mapping is short.
 */
export function mapDocumentTypeCode(code: unknown): ApiDocumentType {
	if (typeof code !== "string") {
		return "other";
	}
	const normalized = code.trim().toUpperCase();
	if (normalized.startsWith("P")) {
		return "passport";
	}
	if (normalized.startsWith("IR") || normalized.startsWith("AR")) {
		return "residence_permit";
	}
	if (
		normalized.startsWith("I") ||
		normalized.startsWith("A") ||
		normalized.startsWith("C")
	) {
		return "national_id";
	}
	return "other";
}

async function importDecryptionKey(jwkString: string): Promise<CryptoKey> {
	const jwk = JSON.parse(jwkString) as JsonWebKey;
	return crypto.subtle.importKey(
		"jwk",
		jwk,
		{ name: "RSA-OAEP", hash: "SHA-256" },
		false,
		["decrypt"],
	);
}

function ack(status = 200): Response {
	return new Response(JSON.stringify({ ok: true }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function refuse(message: string, status: number): Response {
	return new Response(JSON.stringify({ ok: false, message }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function payloadTooLargeResponse(): Response {
	return refuse("Request body is too large.", 413);
}

function parseOrgVerificationMapping(
	value: string,
): OrgVerificationMapping | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}

	if (!(parsed && typeof parsed === "object")) {
		return null;
	}

	const organizationId = Reflect.get(parsed, "organization_id");
	const ownerUserId = Reflect.get(parsed, "owner_user_id");
	if (typeof organizationId !== "string" || typeof ownerUserId !== "string") {
		return null;
	}

	return {
		organization_id: organizationId,
		owner_user_id: ownerUserId,
	};
}

export const Route = createFileRoute("/_api/api/internal/webhook-receiver")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const signatureHeader = request.headers.get(SIGNATURE_HEADER);
				if (!signatureHeader) {
					return refuse("Missing signature header.", 400);
				}

				let rawBody: string;
				try {
					rawBody = await readRequestTextWithLimit(
						request,
						PLATFORM_WEBHOOK_BODY_LIMIT_BYTES,
					);
				} catch (error) {
					if (isRequestBodyTooLarge(error)) {
						return payloadTooLargeResponse();
					}

					throw error;
				}

				const verified = await verifyWebhookSignature({
					payload: rawBody,
					secret: env.KAYLE_PLATFORM_WEBHOOK_SECRET,
					signatureHeader,
				});
				if (!verified.ok) {
					return refuse(verified.message, 401);
				}

				let plaintext: string;
				try {
					const privateKey = await importDecryptionKey(
						env.KAYLE_PLATFORM_WEBHOOK_DECRYPTION_KEY,
					);
					plaintext = await decryptCompactJwe({ jwe: rawBody, privateKey });
				} catch {
					return refuse("Failed to decrypt webhook body.", 400);
				}

				let envelope: WebhookEnvelope;
				try {
					envelope = JSON.parse(plaintext) as WebhookEnvelope;
				} catch {
					return refuse("Webhook body is not valid JSON.", 400);
				}

				if (envelope.type !== "verification.session.succeeded") {
					return ack();
				}

				const sessionId = envelope.metadata?.verification_session_id;
				if (!sessionId) {
					return ack();
				}

				const mappingText = await env.ORG_VERIFICATIONS_KV.get(
					`${KV_PREFIX}${sessionId}`,
				);
				emitCostEvent({
					dataset: resolveAnalyticsDataset(env),
					feature: COST_FEATURES.WebhookDelivery,
					resource: "kv_read",
					quantity: 1,
					unit: "operation",
					workerName: PLATFORM_WORKER_NAME,
					environment: APP_ENVIRONMENT,
					version: APP_VERSION,
				});
				if (!mappingText) {
					return ack();
				}

				const orgVerificationMapping = parseOrgVerificationMapping(mappingText);
				if (!orgVerificationMapping) {
					await env.ORG_VERIFICATIONS_KV.delete(`${KV_PREFIX}${sessionId}`);
					emitCostEvent({
						dataset: resolveAnalyticsDataset(env),
						feature: COST_FEATURES.WebhookDelivery,
						resource: "kv_delete",
						quantity: 1,
						unit: "operation",
						workerName: PLATFORM_WORKER_NAME,
						environment: APP_ENVIRONMENT,
						version: APP_VERSION,
					});
					return ack();
				}

				const claims = envelope.data?.claims ?? {};
				const documentTypeCode = claims.document_type_code;
				const documentNumber = claims.document_number;
				const issuingCountry = claims.issuing_country_code;

				if (
					typeof documentNumber !== "string" ||
					typeof issuingCountry !== "string"
				) {
					return refuse(
						"Webhook payload missing identity claims required for finalize.",
						400,
					);
				}

				const finalizeResponse = await env.API.fetch(
					"http://api/internal/org-verification/finalize",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${env.KAYLE_INTERNAL_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							organization_id: orgVerificationMapping.organization_id,
							document_type: mapDocumentTypeCode(documentTypeCode),
							document_number: documentNumber,
							issuing_country: issuingCountry,
							owner_user_id: orgVerificationMapping.owner_user_id,
						}),
					},
				);

				if (finalizeResponse.status === 409) {
					await env.ORG_VERIFICATIONS_KV.delete(`${KV_PREFIX}${sessionId}`);
					emitCostEvent({
						dataset: resolveAnalyticsDataset(env),
						organizationId: orgVerificationMapping.organization_id,
						feature: COST_FEATURES.WebhookDelivery,
						resource: "kv_delete",
						quantity: 1,
						unit: "operation",
						workerName: PLATFORM_WORKER_NAME,
						environment: APP_ENVIRONMENT,
						version: APP_VERSION,
					});
					return ack();
				}

				if (!finalizeResponse.ok) {
					// Surface a non-2xx so the API webhook delivery system retries
					// (the operation is idempotent on the API side).
					return refuse("Finalize call failed.", 502);
				}

				await env.ORG_VERIFICATIONS_KV.delete(`${KV_PREFIX}${sessionId}`);
				emitCostEvent({
					dataset: resolveAnalyticsDataset(env),
					organizationId: orgVerificationMapping.organization_id,
					feature: COST_FEATURES.WebhookDelivery,
					resource: "kv_delete",
					quantity: 1,
					unit: "operation",
					workerName: PLATFORM_WORKER_NAME,
					environment: APP_ENVIRONMENT,
					version: APP_VERSION,
				});
				return ack();
			},
		},
	},
});
