import {
	SUPPORTED_WEBHOOK_EVENT_TYPES,
	type SupportedWebhookEventType,
	webhookPayloadRetentionHoursSchema,
} from "@kayle-id/config/webhook-events";
import type { db } from "@kayle-id/database/drizzle";
import type {
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { sql } from "drizzle-orm";
import { importJWK, type JWK } from "jose";
import { generateId, generateRandomString } from "@/utils/generate-id";

const SIGNING_SECRET_RANDOM_LENGTH = 32;
const BITS_PER_BYTE = 8;
const MIN_RSA_MODULUS_BITS = 2048;
const MIN_RSA_MODULUS_BYTES = MIN_RSA_MODULUS_BITS / BITS_PER_BYTE;
const WEBHOOK_ENCRYPTION_ALGORITHM = "RSA-OAEP-256";
const WEBHOOK_ENCRYPTION_KEY_TYPE = "RSA";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const PRIVATE_RSA_JWK_FIELDS: ReadonlySet<string> = new Set([
	"d",
	"dp",
	"dq",
	"oth",
	"p",
	"q",
	"qi",
]);
const UNSAFE_KEY_OPS: ReadonlySet<string> = new Set([
	"decrypt",
	"deriveBits",
	"deriveKey",
	"sign",
	"unwrapKey",
]);

type WebhookEncryptionJwkValidation =
	| { ok: true; jwk: JWK }
	| { ok: false; reason: string };

function hasPrivateRsaJwkMaterial(jwk: Record<string, unknown>): boolean {
	for (const field of PRIVATE_RSA_JWK_FIELDS) {
		if (field in jwk) {
			return true;
		}
	}

	return false;
}

function hasSafeKeyOperations(value: unknown): boolean {
	if (value === undefined) {
		return true;
	}

	if (!Array.isArray(value)) {
		return false;
	}

	return (
		value.includes("encrypt") &&
		value.every((operation) => {
			return typeof operation === "string" && !UNSAFE_KEY_OPS.has(operation);
		})
	);
}

function getBase64UrlByteLength(value: string): number | null {
	const paddingLength = (4 - (value.length % 4)) % 4;
	const base64 = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(
		paddingLength,
	)}`;

	try {
		return atob(base64).length;
	} catch {
		return null;
	}
}

export function generateEndpointId(): string {
	return generateId({ type: "whe", length: 32 });
}

export function generateKeyId(): string {
	return generateId({ type: "whk", length: 32 });
}

export function generateSigningSecret(): string {
	return `whsec_${generateRandomString(SIGNING_SECRET_RANDOM_LENGTH)}`;
}

export function acquireWebhookEndpointKeyMutationLock(
	tx: Tx,
	webhookEndpointId: string,
): Promise<unknown> {
	return tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${webhookEndpointId}::text, 3))`,
	);
}

export async function validateWebhookEncryptionPublicJwk(
	value: Record<string, unknown>,
): Promise<WebhookEncryptionJwkValidation> {
	if (value.kty !== WEBHOOK_ENCRYPTION_KEY_TYPE) {
		return { ok: false, reason: "webhook_encryption_key_type_invalid" };
	}

	if (
		typeof value.n !== "string" ||
		value.n.trim() === "" ||
		typeof value.e !== "string" ||
		value.e.trim() === ""
	) {
		return { ok: false, reason: "webhook_encryption_rsa_parameters_invalid" };
	}

	const modulusByteLength = getBase64UrlByteLength(value.n);
	if (modulusByteLength === null || modulusByteLength < MIN_RSA_MODULUS_BYTES) {
		return { ok: false, reason: "webhook_encryption_rsa_modulus_too_small" };
	}

	if (
		typeof value.alg === "string" &&
		value.alg !== WEBHOOK_ENCRYPTION_ALGORITHM
	) {
		return { ok: false, reason: "webhook_encryption_algorithm_invalid" };
	}

	if (typeof value.use === "string" && value.use !== "enc") {
		return { ok: false, reason: "webhook_encryption_key_use_invalid" };
	}

	if (hasPrivateRsaJwkMaterial(value)) {
		return { ok: false, reason: "webhook_encryption_private_key_rejected" };
	}

	if (!hasSafeKeyOperations(value.key_ops)) {
		return { ok: false, reason: "webhook_encryption_key_ops_invalid" };
	}

	const jwk: JWK = {
		alg: WEBHOOK_ENCRYPTION_ALGORITHM,
		e: value.e,
		key_ops: ["encrypt"],
		kty: WEBHOOK_ENCRYPTION_KEY_TYPE,
		n: value.n,
	};

	try {
		await importJWK(jwk, WEBHOOK_ENCRYPTION_ALGORITHM);
	} catch {
		return { ok: false, reason: "webhook_encryption_jwk_invalid" };
	}

	return { ok: true, jwk };
}

function normalizeSubscribedEventTypes(
	value: unknown,
): SupportedWebhookEventType[] {
	if (!Array.isArray(value)) {
		return [...SUPPORTED_WEBHOOK_EVENT_TYPES];
	}

	const normalized = value.filter(
		(eventType): eventType is SupportedWebhookEventType =>
			SUPPORTED_WEBHOOK_EVENT_TYPES.includes(
				eventType as SupportedWebhookEventType,
			),
	);

	return normalized.length > 0
		? normalized
		: [...SUPPORTED_WEBHOOK_EVENT_TYPES];
}

export function mapEndpointRowToResponse(
	row: typeof webhook_endpoints.$inferSelect,
	organizationId: string,
) {
	const undeliveredPayloadRetentionHours =
		webhookPayloadRetentionHoursSchema.parse(
			row.undeliveredPayloadRetentionHours,
		);

	return {
		id: row.id,
		organization_id: organizationId,
		name: row.name,
		url: row.url,
		enabled: row.enabled,
		subscribed_event_types: normalizeSubscribedEventTypes(
			row.subscribedEventTypes,
		),
		undelivered_payload_retention_hours: undeliveredPayloadRetentionHours,
		created_at: row.createdAt.toISOString(),
		updated_at: row.updatedAt.toISOString(),
		disabled_at: row.disabledAt ? row.disabledAt.toISOString() : null,
	};
}

export function mapKeyRowToResponse(
	row: typeof webhook_encryption_keys.$inferSelect,
) {
	return {
		id: row.id,
		webhook_endpoint_id: row.webhookEndpointId,
		key_id: row.keyId,
		algorithm: row.algorithm,
		key_type: row.keyType,
		jwk: row.jwk as Record<string, unknown>,
		is_active: row.isActive,
		created_at: row.createdAt.toISOString(),
		updated_at: row.updatedAt.toISOString(),
		disabled_at: row.disabledAt ? row.disabledAt.toISOString() : null,
	};
}
