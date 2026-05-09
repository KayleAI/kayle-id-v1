import {
	isRequestBodyTooLarge,
	readRequestJsonWithLimit,
	readRequestTextWithLimit,
} from "@kayle-id/config/request-body";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import {
	createDemoSession,
	createDemoWebhookEncryptionKey,
	createDemoWebhookEndpoint,
	disableDemoWebhookEndpoint,
	getDemoOrgSlug,
	getPublicDemoSessionStatus,
} from "@/demo/api";
import type { DemoRequestedShareFields, DemoRunView } from "@/demo/types";
import {
	getDemoWebhookHistory,
	getLatestDemoWebhook,
} from "@/demo/webhook-history";
import {
	createDemoRunId,
	createJsonResponse,
	createRandomToken,
	getDemoRunStub,
	isDemoRunId,
	loadRunRecord,
	persistRunSession,
	persistRunStatus,
	toErrorResponse,
} from "./-helpers";

const DEMO_JSON_BODY_LIMIT_BYTES = 32 * 1024;
const DEMO_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;
const DEMO_RECEIVER_TOKEN_PATTERN = /^[a-z0-9]{32}$/u;
const TRAILING_SLASH_PATTERN = /\/+$/u;

function payloadTooLargeResponse(): Response {
	return createJsonResponse(
		{
			data: null,
			error: {
				code: "PAYLOAD_TOO_LARGE",
				message: "Request body is too large.",
			},
		},
		{ status: 413 },
	);
}

function invalidDemoRunPathResponse(): Response {
	return createJsonResponse(
		{
			data: null,
			error: {
				code: "BAD_REQUEST",
				message: "Demo run path is invalid.",
			},
		},
		{ status: 400 },
	);
}

async function readDemoJson<T>(request: Request): Promise<T | null> {
	try {
		return await readRequestJsonWithLimit<T>(
			request,
			DEMO_JSON_BODY_LIMIT_BYTES,
		);
	} catch (error) {
		if (isRequestBodyTooLarge(error)) {
			throw error;
		}

		return null;
	}
}

async function handleCreateRun(request: Request): Promise<Response> {
	const body = await readDemoJson<{
		public_jwk?: JsonWebKey;
	}>(request);

	if (!(body?.public_jwk && typeof body.public_jwk === "object")) {
		return createJsonResponse(
			{
				data: null,
				error: {
					code: "BAD_REQUEST",
					message: "A public_jwk object is required.",
				},
			},
			{ status: 400 },
		);
	}

	const runId = createDemoRunId();
	const receiverToken = createRandomToken(32);
	const keyId = `demo_${runId}`;
	const orgSlug = getDemoOrgSlug(env);

	let endpointId: string | null = null;

	try {
		const endpoint = await createDemoWebhookEndpoint({
			bindings: env,
			request,
			runId,
			token: receiverToken,
		});
		endpointId = endpoint.endpointId;

		await createDemoWebhookEncryptionKey({
			bindings: env,
			endpointId,
			keyId,
			publicJwk: body.public_jwk,
		});

		await getDemoRunStub(runId).fetch("https://demo.internal/initialize", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				endpoint_id: endpointId,
				key_id: keyId,
				org_slug: orgSlug,
				receiver_token: receiverToken,
			}),
		});

		return createJsonResponse({
			data: {
				demo_run_id: runId,
				endpoint_id: endpointId,
				org_slug: orgSlug,
				signing_secret: endpoint.signingSecret,
			},
			error: null,
		});
	} catch (error) {
		if (endpointId) {
			try {
				await disableDemoWebhookEndpoint({
					bindings: env,
					endpointId,
				});
			} catch {
				// Best-effort cleanup only.
			}
		}

		return toErrorResponse(error);
	}
}

async function handleCreateSession({
	request,
	runId,
}: {
	request: Request;
	runId: string;
}): Promise<Response> {
	const run = await loadRunRecord(runId);
	if (!run) {
		return createJsonResponse(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Demo run not found.",
				},
			},
			{ status: 404 },
		);
	}

	if (run.session_id) {
		return createJsonResponse(
			{
				data: null,
				error: {
					code: "CONFLICT",
					message: "A verification session already exists for this demo run.",
				},
			},
			{ status: 409 },
		);
	}

	const body =
		(await readDemoJson<{
			share_fields?: DemoRequestedShareFields;
		}>(request)) ?? {};

	const session = await createDemoSession({
		bindings: env,
		shareFields: body.share_fields,
	});

	await persistRunSession({
		runId,
		sessionId: session.id,
		shareFields: session.share_fields,
		verificationUrl: session.verification_url,
	});

	return createJsonResponse({
		data: {
			session_id: session.id,
			share_fields: session.share_fields,
			verification_url: session.verification_url,
		},
		error: null,
	});
}

async function handleGetRun(runId: string): Promise<Response> {
	const run = await loadRunRecord(runId);
	if (!run) {
		return createJsonResponse(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Demo run not found.",
				},
			},
			{ status: 404 },
		);
	}

	const sessionStatus = run.session_id
		? await getPublicDemoSessionStatus({
				bindings: env,
				sessionId: run.session_id,
			})
		: null;

	if (sessionStatus) {
		await persistRunStatus({
			runId,
			sessionStatus,
		});
	}

	const webhooks = getDemoWebhookHistory(run);

	return createJsonResponse({
		data: {
			id: runId,
			endpoint_id: run.endpoint_id,
			key_id: run.key_id,
			org_slug: run.org_slug,
			session_id: run.session_id,
			session_status: sessionStatus ?? run.last_session_status,
			share_fields: run.share_fields,
			verification_url: run.verification_url,
			webhook: getLatestDemoWebhook(run),
			webhooks,
		} satisfies DemoRunView,
		error: null,
	});
}

async function handleReceiveWebhook({
	request,
	runId,
	token,
}: {
	request: Request;
	runId: string;
	token: string;
}): Promise<Response> {
	if (!isDemoRunId(runId) || !DEMO_RECEIVER_TOKEN_PATTERN.test(token)) {
		return createJsonResponse(
			{
				data: null,
				error: {
					code: "BAD_REQUEST",
					message: "Demo webhook path is invalid.",
				},
			},
			{ status: 400 },
		);
	}

	const body = await readRequestTextWithLimit(
		request,
		DEMO_WEBHOOK_BODY_LIMIT_BYTES,
	);
	const response = await getDemoRunStub(runId).fetch(
		`https://demo.internal/webhook?token=${encodeURIComponent(token)}`,
		{
			method: "POST",
			headers: {
				"X-Kayle-Delivery-Id": request.headers.get("X-Kayle-Delivery-Id") ?? "",
				"X-Kayle-Event": request.headers.get("X-Kayle-Event") ?? "",
				"X-Kayle-Signature": request.headers.get("X-Kayle-Signature") ?? "",
			},
			body,
		},
	);

	if (response.status === 204) {
		return new Response(null, { status: 204 });
	}

	const payload = await response.json().catch(() => ({
		data: null,
		error: {
			message: "Webhook storage failed.",
		},
	}));

	return createJsonResponse(payload, { status: response.status });
}

export const Route = createFileRoute("/_api/api/demo/$")({
	server: {
		handlers: {
			ANY: async ({ request }) => {
				try {
					const pathname = new URL(request.url).pathname.replace(
						TRAILING_SLASH_PATTERN,
						"",
					);
					const segments = pathname.split("/").filter(Boolean);

					if (
						request.method === "POST" &&
						segments.length === 3 &&
						segments[0] === "api" &&
						segments[1] === "demo" &&
						segments[2] === "runs"
					) {
						return await handleCreateRun(request);
					}

					if (
						request.method === "GET" &&
						segments.length === 4 &&
						segments[0] === "api" &&
						segments[1] === "demo" &&
						segments[2] === "runs"
					) {
						if (!isDemoRunId(segments[3])) {
							return invalidDemoRunPathResponse();
						}

						return await handleGetRun(segments[3]);
					}

					if (
						request.method === "POST" &&
						segments.length === 5 &&
						segments[0] === "api" &&
						segments[1] === "demo" &&
						segments[2] === "runs" &&
						segments[4] === "session"
					) {
						if (!isDemoRunId(segments[3])) {
							return invalidDemoRunPathResponse();
						}

						return await handleCreateSession({
							request,
							runId: segments[3],
						});
					}

					if (
						request.method === "POST" &&
						segments.length === 5 &&
						segments[0] === "api" &&
						segments[1] === "demo" &&
						segments[2] === "webhooks"
					) {
						return await handleReceiveWebhook({
							request,
							runId: segments[3],
							token: segments[4],
						});
					}

					return createJsonResponse(
						{
							data: null,
							error: {
								code: "NOT_FOUND",
								message: "Demo route not found.",
							},
						},
						{ status: 404 },
					);
				} catch (error) {
					if (isRequestBodyTooLarge(error)) {
						return payloadTooLargeResponse();
					}

					return toErrorResponse(error);
				}
			},
		},
	},
});
