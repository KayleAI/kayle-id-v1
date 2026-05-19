import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class {
		protected readonly ctx: unknown;
		protected readonly env: unknown;

		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

import { DemoRunMailbox } from "./run-mailbox";

function createStorage() {
	const values = new Map<string, unknown>();
	let alarmAt: number | null = null;

	return {
		storage: {
			deleteAll: async () => {
				values.clear();
			},
			get: async <T>(key: string): Promise<T | undefined> =>
				values.get(key) as T | undefined,
			put: async (key: string, value: unknown) => {
				values.set(key, value);
			},
			setAlarm: async (value: number) => {
				alarmAt = value;
			},
		},
		get alarmAt() {
			return alarmAt;
		},
		values,
	};
}

function createMailbox(env: Record<string, unknown> = {}) {
	const fake = createStorage();
	const mailbox = new DemoRunMailbox(
		{ storage: fake.storage } as never,
		env as never,
	);

	return {
		fake,
		mailbox,
	};
}

async function initializeMailbox(
	mailbox: DemoRunMailbox,
	endpointId = "whe_demo_test",
): Promise<Response> {
	return await mailbox.fetch(
		new Request("https://demo.internal/initialize", {
			body: JSON.stringify({
				endpoint_id: endpointId,
				key_id: "demo_key",
				org_slug: "kayle",
				receiver_token: "receiver_token",
			}),
			headers: {
				"Content-Type": "application/json",
			},
			method: "POST",
		}),
	);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("DemoRunMailbox rate limiting", () => {
	test("limits demo run creation attempts within a rolling window", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
		const { mailbox } = createMailbox();
		const request = new Request("https://demo.internal/rate-limit/demo-runs", {
			method: "POST",
		});

		for (let index = 0; index < 100; index += 1) {
			const response = await mailbox.fetch(request.clone());
			expect(response.status).toBe(204);
		}

		const limitedResponse = await mailbox.fetch(request.clone());
		expect(limitedResponse.status).toBe(429);
		expect(limitedResponse.headers.get("Retry-After")).toBe("3600");
		await expect(limitedResponse.json()).resolves.toMatchObject({
			error: {
				code: "RATE_LIMITED",
			},
		});

		vi.setSystemTime(new Date("2026-05-09T13:00:01.000Z"));

		const resetResponse = await mailbox.fetch(request.clone());
		expect(resetResponse.status).toBe(204);
	});

	test("cleans up rate-limit-only objects on alarm", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
		const { fake, mailbox } = createMailbox();

		const response = await mailbox.fetch(
			new Request("https://demo.internal/rate-limit/demo-runs", {
				method: "POST",
			}),
		);

		expect(response.status).toBe(204);
		expect(fake.values.size).toBe(1);
		expect(fake.alarmAt).not.toBeNull();

		await mailbox.alarm();

		expect(fake.values.size).toBe(0);
	});
});

describe("DemoRunMailbox cleanup", () => {
	test("schedules endpoint deletion cleanup when a demo session expires", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				data: {
					message: "Webhook endpoint deleted.",
					status: "success",
				},
				error: null,
			}),
		);
		const { fake, mailbox } = createMailbox({
			API: {
				fetch: fetchMock,
			},
			KAYLE_DEMO_API_KEY: "demo_api_key",
		});

		const initializeResponse = await initializeMailbox(mailbox);
		expect(initializeResponse.status).toBe(204);
		const statusResponse = await mailbox.fetch(
			new Request("https://demo.internal/session-status", {
				body: JSON.stringify({
					completed_at: "2026-05-09T12:00:00.000Z",
					is_terminal: true,
					latest_attempt: null,
					redirect_url: null,
					session_id: "vs_demo_expired",
					status: "expired",
				}),
				headers: {
					"Content-Type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(statusResponse.status).toBe(204);
		expect(fake.alarmAt).toBe(new Date("2026-05-09T12:30:00.000Z").getTime());

		await mailbox.alarm();

		expect(fetchMock).toHaveBeenCalledWith(
			"http://api/v1/webhooks/endpoints/whe_demo_test",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
		expect(fake.values.size).toBe(0);
	});

	test("deletes the demo webhook endpoint on alarm", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				data: {
					message: "Webhook endpoint deleted.",
					status: "success",
				},
				error: null,
			}),
		);
		const { fake, mailbox } = createMailbox({
			API: {
				fetch: fetchMock,
			},
			KAYLE_DEMO_API_KEY: "demo_api_key",
		});

		const initializeResponse = await initializeMailbox(mailbox);
		expect(initializeResponse.status).toBe(204);
		expect(fake.values.size).toBe(1);

		await mailbox.alarm();

		expect(fetchMock).toHaveBeenCalledWith(
			"http://api/v1/webhooks/endpoints/whe_demo_test",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
		expect(fake.values.size).toBe(0);
	});

	test("retains demo run state and retries when endpoint deletion fails", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json(
				{
					data: null,
					error: {
						message: "Upstream cleanup failed.",
					},
				},
				{ status: 503 },
			),
		);
		const { fake, mailbox } = createMailbox({
			API: {
				fetch: fetchMock,
			},
			KAYLE_DEMO_API_KEY: "demo_api_key",
		});

		const initializeResponse = await initializeMailbox(mailbox);
		expect(initializeResponse.status).toBe(204);

		await mailbox.alarm();

		expect(fake.values.size).toBe(1);
		expect(fake.alarmAt).toBe(new Date("2026-05-09T12:05:00.000Z").getTime());
	});
});
