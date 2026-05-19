import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import { afterEach, expect, test, vi } from "vitest";
import {
	buildDemoWebhookUrl,
	createDemoSession,
	createDemoWebhookEndpoint,
	deleteDemoWebhookEndpoint,
	getPublicDemoSessionStatus,
} from "./api";

const originalNodeEnv = process.env.NODE_ENV;
const originalKayleEnvironment = process.env.KAYLE_ENVIRONMENT;

afterEach(() => {
	process.env.NODE_ENV = originalNodeEnv;
	if (originalKayleEnvironment === undefined) {
		delete process.env.KAYLE_ENVIRONMENT;
	} else {
		process.env.KAYLE_ENVIRONMENT = originalKayleEnvironment;
	}
});

test("buildDemoWebhookUrl uses the local HTTP proxy in development", () => {
	process.env.NODE_ENV = "development";
	delete process.env.KAYLE_ENVIRONMENT;

	expect(
		buildDemoWebhookUrl({
			runId: "demo_123",
			token: "token_123",
		}),
	).toBe("http://127.0.0.1:3001/api/demo/webhooks/demo_123/token_123");
});

test("buildDemoWebhookUrl pins the canonical origin in production", () => {
	process.env.NODE_ENV = "production";
	process.env.KAYLE_ENVIRONMENT = "production";

	expect(
		buildDemoWebhookUrl({
			runId: "demo_123",
			token: "token_123",
		}),
	).toBe("https://kayle.id/api/demo/webhooks/demo_123/token_123");
});

test("buildDemoWebhookUrl pins the staging origin on staging despite NODE_ENV=production", () => {
	process.env.NODE_ENV = "production";
	process.env.KAYLE_ENVIRONMENT = "staging";

	expect(
		buildDemoWebhookUrl({
			runId: "demo_123",
			token: "token_123",
		}),
	).toBe("https://staging.kayle.id/api/demo/webhooks/demo_123/token_123");
});

test("createDemoWebhookEndpoint subscribes the demo to every supported public event", async () => {
	const fetchMock = vi.fn().mockResolvedValue(
		Response.json({
			data: {
				endpoint: {
					id: "whe_demo_test",
				},
				signing_secret: "whsec_demo_test",
			},
			error: null,
		}),
	);

	await createDemoWebhookEndpoint({
		bindings: {
			API: {
				fetch: fetchMock,
			},
			KAYLE_DEMO_API_KEY: "demo_api_key",
		},
		runId: "demo_123",
		token: "token_123",
	});

	expect(fetchMock).toHaveBeenCalledTimes(1);

	const [url, requestInit] = fetchMock.mock.calls[0] ?? [];

	expect(url).toBe("http://api/v1/webhooks/endpoints");
	expect(requestInit?.method).toBe("POST");
	expect(JSON.parse(String(requestInit?.body))).toEqual({
		enabled: true,
		labels: ["demo", "run:123"],
		subscribed_event_types: [...SUPPORTED_WEBHOOK_EVENT_TYPES],
		url: "http://127.0.0.1:3001/api/demo/webhooks/demo_123/token_123",
	});
});

test("createDemoWebhookEndpoint rejects malformed upstream success responses", async () => {
	const fetchMock = vi.fn().mockResolvedValue(
		Response.json({
			error: null,
		}),
	);

	await expect(
		createDemoWebhookEndpoint({
			bindings: {
				API: {
					fetch: fetchMock,
				},
				KAYLE_DEMO_API_KEY: "demo_api_key",
			},
			runId: "demo_123",
			token: "token_123",
		}),
	).rejects.toMatchObject({
		message: "Unexpected upstream response.",
		status: 200,
	});
});

test("deleteDemoWebhookEndpoint deletes the demo endpoint", async () => {
	const fetchMock = vi.fn().mockResolvedValue(
		Response.json({
			data: {
				message: "Webhook endpoint deleted.",
				status: "success",
			},
			error: null,
		}),
	);

	await deleteDemoWebhookEndpoint({
		bindings: {
			API: {
				fetch: fetchMock,
			},
			KAYLE_DEMO_API_KEY: "demo_api_key",
		},
		endpointId: "whe_demo_test",
	});

	expect(fetchMock).toHaveBeenCalledWith(
		"http://api/v1/webhooks/endpoints/whe_demo_test",
		expect.objectContaining({
			method: "DELETE",
		}),
	);
});

test("deleteDemoWebhookEndpoint treats already-deleted endpoints as clean", async () => {
	const fetchMock = vi.fn().mockResolvedValue(
		Response.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Webhook endpoint not found.",
				},
			},
			{ status: 404 },
		),
	);

	await expect(
		deleteDemoWebhookEndpoint({
			bindings: {
				API: {
					fetch: fetchMock,
				},
				KAYLE_DEMO_API_KEY: "demo_api_key",
			},
			endpointId: "whe_demo_missing",
		}),
	).resolves.toBeUndefined();
});

test("createDemoSession targets the demo run webhook endpoint", async () => {
	const fetchMock = vi.fn().mockResolvedValue(
		Response.json({
			data: {
				id: "vs_demo_test",
				share_fields: {},
				verification_url: "https://verify.kayle.id/vs_demo_test",
			},
			error: null,
		}),
	);

	await createDemoSession({
		bindings: {
			API: {
				fetch: fetchMock,
			},
			KAYLE_DEMO_API_KEY: "demo_api_key",
		},
		shareFields: undefined,
		webhookEndpointId: "whe_demo_test",
	});

	expect(fetchMock).toHaveBeenCalledWith(
		"http://api/v1/sessions",
		expect.objectContaining({
			body: JSON.stringify({
				webhook_endpoint_id: "whe_demo_test",
			}),
			method: "POST",
		}),
	);
});

test("getPublicDemoSessionStatus returns null for missing public sessions", async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValue(new Response(null, { status: 404 }));

	await expect(
		getPublicDemoSessionStatus({
			bindings: {
				API: {
					fetch: fetchMock,
				},
			},
			sessionId: "vs_missing",
		}),
	).resolves.toBeNull();

	expect(fetchMock).toHaveBeenCalledWith(
		"http://api/v1/verify/session/vs_missing/status",
	);
});

test("getPublicDemoSessionStatus throws the upstream API error message", async () => {
	const fetchMock = vi.fn().mockResolvedValue(
		Response.json(
			{
				data: null,
				error: {
					code: "SESSION_EXPIRED",
					hint: "Start a new session.",
					message: "Session expired.",
				},
			},
			{ status: 410 },
		),
	);

	await expect(
		getPublicDemoSessionStatus({
			bindings: {
				API: {
					fetch: fetchMock,
				},
			},
			sessionId: "vs_expired",
		}),
	).rejects.toMatchObject({
		code: "SESSION_EXPIRED",
		hint: "Start a new session.",
		message: "Session expired.",
		status: 410,
	});
});
