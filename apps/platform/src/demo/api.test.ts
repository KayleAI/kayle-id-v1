import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import { afterEach, expect, test, vi } from "vitest";
import {
	buildDemoWebhookUrl,
	createDemoWebhookEndpoint,
	getPublicDemoSessionStatus,
} from "./api";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
	process.env.NODE_ENV = originalNodeEnv;
});

test("buildDemoWebhookUrl uses the local HTTP proxy in development", () => {
	process.env.NODE_ENV = "development";

	expect(
		buildDemoWebhookUrl({
			request: new Request("https://localhost:3000/api/demo/runs"),
			runId: "demo_123",
			token: "token_123",
		}),
	).toBe("http://127.0.0.1:3001/api/demo/webhooks/demo_123/token_123");
});

test("buildDemoWebhookUrl keeps the request origin in production", () => {
	process.env.NODE_ENV = "production";

	expect(
		buildDemoWebhookUrl({
			request: new Request("https://kayle.id/api/demo/runs"),
			runId: "demo_123",
			token: "token_123",
		}),
	).toBe("https://kayle.id/api/demo/webhooks/demo_123/token_123");
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
		request: new Request("https://kayle.id/api/demo/runs", {
			method: "POST",
		}),
		runId: "demo_123",
		token: "token_123",
	});

	expect(fetchMock).toHaveBeenCalledTimes(1);

	const [url, requestInit] = fetchMock.mock.calls[0] ?? [];

	expect(url).toBe("http://api/v1/webhooks/endpoints");
	expect(requestInit?.method).toBe("POST");
	expect(JSON.parse(String(requestInit?.body))).toEqual({
		enabled: true,
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
			request: new Request("https://kayle.id/api/demo/runs", {
				method: "POST",
			}),
			runId: "demo_123",
			token: "token_123",
		}),
	).rejects.toMatchObject({
		message: "Unexpected upstream response.",
		status: 200,
	});
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
			sessionId: "vs_live_missing",
		}),
	).resolves.toBeNull();

	expect(fetchMock).toHaveBeenCalledWith(
		"http://api/v1/verify/session/vs_live_missing/status",
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
			sessionId: "vs_live_expired",
		}),
	).rejects.toMatchObject({
		code: "SESSION_EXPIRED",
		hint: "Start a new session.",
		message: "Session expired.",
		status: 410,
	});
});
