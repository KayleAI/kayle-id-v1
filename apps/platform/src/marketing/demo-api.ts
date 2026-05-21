import { formatPublicDemoPayload } from "@/demo/claim-fields";
import { decryptCompactJwe, verifyWebhookSignature } from "@/demo/crypto";
import type {
	DemoRequestedShareFields,
	DemoRunCreateResult,
	DemoRunSessionResult,
	DemoRunView,
	DemoWebhookEnvelope,
} from "@/demo/types";
import type { ProcessedWebhookState } from "@/marketing/demo-attempts";
import { requestApiResource } from "@/utils/api-client";
import { getErrorMessage } from "@/utils/get-error-message";

const DEMO_RUNS_PATH = "/api/demo/runs";

export async function createDemoRun({
	publicJwk,
}: {
	publicJwk: JsonWebKey;
}): Promise<DemoRunCreateResult> {
	return requestApiResource<DemoRunCreateResult>({
		basePath: DEMO_RUNS_PATH,
		body: {
			public_jwk: publicJwk,
		},
		method: "POST",
		unexpectedMessage: "Failed to create demo run.",
	});
}

export async function createDemoVerificationSession({
	runId,
	shareFields,
}: {
	runId: string;
	shareFields: DemoRequestedShareFields | undefined;
}): Promise<DemoRunSessionResult> {
	return requestApiResource<DemoRunSessionResult>({
		basePath: DEMO_RUNS_PATH,
		body: shareFields
			? {
					share_fields: shareFields,
				}
			: {},
		method: "POST",
		path: `/${runId}/session`,
		unexpectedMessage: "Failed to create demo session.",
	});
}

export async function getDemoRun(runId: string): Promise<DemoRunView> {
	return requestApiResource<DemoRunView>({
		basePath: DEMO_RUNS_PATH,
		path: `/${runId}`,
		unexpectedMessage: "Failed to load demo run.",
	});
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
			error: getErrorMessage(error, "Failed to decrypt the webhook payload."),
			status: "invalid",
		};
	}
}
