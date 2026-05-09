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

function createMailbox() {
	const fake = createStorage();
	const mailbox = new DemoRunMailbox(
		{ storage: fake.storage } as never,
		{} as never,
	);

	return {
		fake,
		mailbox,
	};
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
