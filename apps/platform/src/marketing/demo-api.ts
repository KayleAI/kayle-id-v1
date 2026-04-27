import { formatPublicDemoPayload } from "@/demo/claim-fields";
import { decryptCompactJwe, verifyWebhookSignature } from "@/demo/crypto";
import type {
	DemoRunCreateResult,
	DemoRunSessionResult,
	DemoRunView,
	DemoWebhookEnvelope,
} from "@/demo/types";
import type { ProcessedWebhookState } from "@/marketing/demo-attempts";

export interface ApiResponse<T> {
	data: T | null;
	error: {
		code?: string | null;
		hint?: string | null;
		message?: string | null;
	} | null;
}

async function readJsonResponse<T>(
	response: Response,
): Promise<ApiResponse<T>> {
	try {
		return (await response.json()) as ApiResponse<T>;
	} catch {
		return {
			data: null,
			error: {
				message: "Unexpected response from the demo backend.",
			},
		};
	}
}

export async function createDemoRun({
	publicJwk,
}: {
	publicJwk: JsonWebKey;
}): Promise<DemoRunCreateResult> {
	const response = await fetch("/api/demo/runs", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			public_jwk: publicJwk,
		}),
	});

	const payload = await readJsonResponse<DemoRunCreateResult>(response);
	if (!(response.ok && payload.data)) {
		throw new Error(payload.error?.message ?? "Failed to create demo run.");
	}

	return payload.data;
}

export async function createDemoVerificationSession({
	runId,
	shareFields,
}: {
	runId: string;
	shareFields:
		| Record<string, { reason: string; required: boolean }>
		| undefined;
}): Promise<DemoRunSessionResult> {
	const response = await fetch(`/api/demo/runs/${runId}/session`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(
			shareFields
				? {
						share_fields: shareFields,
					}
				: {},
		),
	});

	const payload = await readJsonResponse<DemoRunSessionResult>(response);
	if (!(response.ok && payload.data)) {
		throw new Error(payload.error?.message ?? "Failed to create demo session.");
	}

	return payload.data;
}

export async function getDemoRun(runId: string): Promise<DemoRunView> {
	const response = await fetch(`/api/demo/runs/${runId}`);
	const payload = await readJsonResponse<DemoRunView>(response);

	if (!(response.ok && payload.data)) {
		throw new Error(payload.error?.message ?? "Failed to load demo run.");
	}

	return payload.data;
}

export async function processWebhookReceipt({
	isReplay,
	privateKey,
	secret,
	webhook,
}: {
	isReplay: boolean;
	privateKey: CryptoKey;
	secret: string;
	webhook: DemoWebhookEnvelope;
}): Promise<ProcessedWebhookState> {
	const signatureHeader = webhook.signature_header;
	if (!signatureHeader) {
		return {
			decryptedPayload: null,
			error: "The webhook signature header was missing.",
			status: "invalid",
		};
	}

	const verification = await verifyWebhookSignature({
		deliveryId: webhook.delivery_id,
		isReplay,
		payload: webhook.body,
		receivedAt: webhook.received_at,
		secret,
		signatureHeader,
	});

	if (!verification.ok) {
		return {
			decryptedPayload: null,
			error: verification.message,
			status: "invalid",
		};
	}

	try {
		const plaintext = await decryptCompactJwe({
			jwe: webhook.body,
			privateKey,
		});
		const decryptedPayload = (() => {
			try {
				return formatPublicDemoPayload(plaintext);
			} catch {
				return plaintext;
			}
		})();

		return {
			decryptedPayload,
			error: null,
			status: "decrypted",
		};
	} catch (error) {
		return {
			decryptedPayload: null,
			error:
				error instanceof Error
					? error.message
					: "Failed to decrypt the webhook payload.",
			status: "invalid",
		};
	}
}
