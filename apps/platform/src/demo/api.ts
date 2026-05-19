import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import type {
	DemoRequestedShareFields,
	DemoSessionShareFields,
	DemoSessionStatus,
} from "./types";

interface DemoBindings {
	API?: Fetcher;
	KAYLE_DEMO_API_KEY?: string;
	KAYLE_DEMO_ORG_SLUG?: string;
}

interface ApiErrorPayload {
	code?: string;
	hint?: string;
	message?: string;
}

interface ApiEnvelope<T> {
	data: T | null;
	error: ApiErrorPayload | null;
}

const LOCAL_DEMO_WEBHOOK_ORIGIN = "http://127.0.0.1:3001";
const PRODUCTION_DEMO_WEBHOOK_ORIGIN = "https://kayle.id";
const STAGING_DEMO_WEBHOOK_ORIGIN = "https://staging.kayle.id";
const UNEXPECTED_UPSTREAM_RESPONSE = "Unexpected upstream response.";

export class DemoApiError extends Error {
	readonly code: string | null;
	readonly hint: string | null;
	readonly status: number;

	constructor({
		code,
		hint,
		message,
		status,
	}: {
		code?: string | null;
		hint?: string | null;
		message: string;
		status: number;
	}) {
		super(message);
		this.name = "DemoApiError";
		this.code = code ?? null;
		this.hint = hint ?? null;
		this.status = status;
	}
}

function requireApiBinding(bindings: DemoBindings): Fetcher {
	if (!bindings.API) {
		throw new DemoApiError({
			message: "Platform API binding is not configured.",
			status: 500,
		});
	}

	return bindings.API;
}

export function getDemoApiKey(bindings: DemoBindings): string {
	const apiKey = bindings.KAYLE_DEMO_API_KEY?.trim();
	if (!apiKey) {
		throw new DemoApiError({
			message: "KAYLE_DEMO_API_KEY is not configured.",
			status: 500,
		});
	}

	return apiKey;
}

export function getDemoOrgSlug(bindings: DemoBindings): string {
	return bindings.KAYLE_DEMO_ORG_SLUG?.trim() || "kayle";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getStringValue(
	payload: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = payload[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseErrorPayload(value: unknown): ApiErrorPayload | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (!isRecord(value)) {
		return {
			message: UNEXPECTED_UPSTREAM_RESPONSE,
		};
	}

	const error = {
		code: getStringValue(value, "code"),
		hint: getStringValue(value, "hint"),
		message: getStringValue(value, "message"),
	};

	return error.code || error.hint || error.message ? error : null;
}

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
	try {
		const payload = await response.json();

		if (!isRecord(payload) || !("data" in payload)) {
			return {
				data: null,
				error: {
					message: UNEXPECTED_UPSTREAM_RESPONSE,
				},
			};
		}

		return {
			data:
				payload.data === null || payload.data === undefined
					? null
					: (payload.data as T),
			error: parseErrorPayload(payload.error),
		};
	} catch {
		return {
			data: null,
			error: {
				message: response.statusText || UNEXPECTED_UPSTREAM_RESPONSE,
			},
		};
	}
}

function unwrapEnvelope<T>({
	envelope,
	fallbackMessage,
	response,
}: {
	envelope: ApiEnvelope<T>;
	fallbackMessage: string;
	response: Response;
}): T {
	if (response.ok && envelope.data !== null && envelope.data !== undefined) {
		return envelope.data;
	}

	throw new DemoApiError({
		code: envelope.error?.code,
		hint: envelope.error?.hint,
		message: envelope.error?.message ?? fallbackMessage,
		status: response.status,
	});
}

async function requestApi<T>({
	bindings,
	body,
	headers,
	method,
	path,
	useAuth,
}: {
	bindings: DemoBindings;
	body?: unknown;
	headers?: HeadersInit;
	method: string;
	path: string;
	useAuth: boolean;
}): Promise<T> {
	const api = requireApiBinding(bindings);
	const requestHeaders = new Headers(headers);

	if (useAuth) {
		requestHeaders.set("Authorization", `Bearer ${getDemoApiKey(bindings)}`);
	}

	if (body !== undefined) {
		requestHeaders.set("Content-Type", "application/json");
	}

	const response = await api.fetch(`http://api${path}`, {
		method,
		headers: requestHeaders,
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	const envelope = await parseEnvelope<T>(response);
	return unwrapEnvelope({
		envelope,
		fallbackMessage: `Upstream request failed with ${response.status}.`,
		response,
	});
}

function resolveDemoWebhookOrigin(): string {
	// Staging pins NODE_ENV=production too, so NODE_ENV alone can't separate
	// the two prod-like deploys — use KAYLE_ENVIRONMENT, which staging sets
	// to "staging" and production sets to "production".
	if (process.env.KAYLE_ENVIRONMENT === "staging") {
		return STAGING_DEMO_WEBHOOK_ORIGIN;
	}
	if (process.env.NODE_ENV === "production") {
		return PRODUCTION_DEMO_WEBHOOK_ORIGIN;
	}
	return LOCAL_DEMO_WEBHOOK_ORIGIN;
}

export function buildDemoWebhookUrl({
	runId,
	token,
}: {
	runId: string;
	token: string;
}): string {
	const url = new URL(resolveDemoWebhookOrigin());
	url.pathname = `/api/demo/webhooks/${runId}/${token}`;
	url.search = "";
	url.hash = "";
	return url.toString();
}

function getDemoRunLabel(runId: string): string {
	const labelId = runId.startsWith("demo_")
		? runId.slice("demo_".length)
		: runId;
	return `run:${labelId}`;
}

export async function createDemoWebhookEndpoint({
	bindings,
	runId,
	token,
}: {
	bindings: DemoBindings;
	runId: string;
	token: string;
}): Promise<{ endpointId: string; signingSecret: string }> {
	const data = await requestApi<{
		endpoint: {
			id: string;
		};
		signing_secret: string;
	}>({
		bindings,
		method: "POST",
		path: "/v1/webhooks/endpoints",
		useAuth: true,
		body: {
			url: buildDemoWebhookUrl({ runId, token }),
			enabled: true,
			labels: ["demo", getDemoRunLabel(runId)],
			subscribed_event_types: [...SUPPORTED_WEBHOOK_EVENT_TYPES],
		},
	});

	return {
		endpointId: data.endpoint.id,
		signingSecret: data.signing_secret,
	};
}

export async function createDemoWebhookEncryptionKey({
	bindings,
	endpointId,
	keyId,
	publicJwk,
}: {
	bindings: DemoBindings;
	endpointId: string;
	keyId: string;
	publicJwk: JsonWebKey;
}): Promise<void> {
	await requestApi({
		bindings,
		method: "POST",
		path: `/v1/webhooks/endpoints/${endpointId}/keys`,
		useAuth: true,
		body: {
			key_id: keyId,
			jwk: publicJwk,
			algorithm: "RSA-OAEP-256",
			key_type: "RSA",
		},
	});
}

export async function deleteDemoWebhookEndpoint({
	bindings,
	endpointId,
}: {
	bindings: DemoBindings;
	endpointId: string;
}): Promise<void> {
	try {
		await requestApi({
			bindings,
			method: "DELETE",
			path: `/v1/webhooks/endpoints/${endpointId}`,
			useAuth: true,
		});
	} catch (error) {
		if (error instanceof DemoApiError && error.status === 404) {
			return;
		}

		throw error;
	}
}

export function createDemoSession({
	bindings,
	shareFields,
	webhookEndpointId,
}: {
	bindings: DemoBindings;
	shareFields: DemoRequestedShareFields | undefined;
	webhookEndpointId: string;
}): Promise<{
	id: string;
	share_fields: DemoSessionShareFields;
	verification_url: string;
}> {
	return requestApi<{
		id: string;
		share_fields: DemoSessionShareFields;
		verification_url: string;
	}>({
		bindings,
		method: "POST",
		path: "/v1/sessions",
		useAuth: true,
		body: {
			...(shareFields ? { share_fields: shareFields } : {}),
			webhook_endpoint_id: webhookEndpointId,
		},
	});
}

export async function getPublicDemoSessionStatus({
	bindings,
	sessionId,
}: {
	bindings: DemoBindings;
	sessionId: string;
}): Promise<DemoSessionStatus | null> {
	const api = requireApiBinding(bindings);
	const response = await api.fetch(
		`http://api/v1/verify/session/${sessionId}/status`,
	);

	if (response.status === 404) {
		return null;
	}

	const envelope = await parseEnvelope<DemoSessionStatus>(response);
	return unwrapEnvelope({
		envelope,
		fallbackMessage: `Session status request failed with ${response.status}.`,
		response,
	});
}
