import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	runStorageAtRestCron,
	shouldRunStorageAtRest,
} from "./storage-at-rest";

describe("shouldRunStorageAtRest", () => {
	it("fires at exactly midnight UTC", () => {
		const t = Date.UTC(2026, 0, 15, 0, 0, 0);
		expect(shouldRunStorageAtRest(t)).toBe(true);
	});

	it("fires within the first ~90 seconds of the day", () => {
		const t = Date.UTC(2026, 0, 15, 0, 1, 0);
		expect(shouldRunStorageAtRest(t)).toBe(true);
	});

	it("skips later in the 00:00 hour", () => {
		const t = Date.UTC(2026, 0, 15, 0, 5, 0);
		expect(shouldRunStorageAtRest(t)).toBe(false);
	});

	it("skips every other hour", () => {
		const t = Date.UTC(2026, 0, 15, 12, 0, 0);
		expect(shouldRunStorageAtRest(t)).toBe(false);
	});

	it("skips 23:59 of the prior day", () => {
		const t = Date.UTC(2026, 0, 14, 23, 59, 0);
		expect(shouldRunStorageAtRest(t)).toBe(false);
	});
});

type CapturedPoint = {
	indexes?: readonly string[];
	blobs?: readonly string[];
	doubles?: readonly number[];
};

interface MockEnv {
	KAYLE_ID_ANALYTICS: { writeDataPoint(p: CapturedPoint): void };
	TRUST_STORE: {
		prepare(sql: string): {
			bind(...args: unknown[]): {
				run(): Promise<{ meta?: { changes?: number } }>;
			};
		};
	};
	CLOUDFLARE_API_TOKEN: string;
	CLOUDFLARE_ACCOUNT_ID: string;
}

function createMockEnv(opts: {
	insertChanges: number;
	points: CapturedPoint[];
}): MockEnv {
	return {
		KAYLE_ID_ANALYTICS: {
			writeDataPoint(p: CapturedPoint) {
				opts.points.push(p);
			},
		},
		TRUST_STORE: {
			prepare() {
				return {
					bind() {
						return {
							async run() {
								return { meta: { changes: opts.insertChanges } };
							},
						};
					},
				};
			},
		},
		CLOUDFLARE_API_TOKEN: "test-token",
		CLOUDFLARE_ACCOUNT_ID: "test-account",
	};
}

describe("runStorageAtRestCron idempotency", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = mock(
			async () =>
				new Response(
					JSON.stringify({
						success: true,
						result: { payloadSize: 1024, metadataSize: 0, file_size: 2048 },
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				),
		) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		mock.restore();
	});

	it("emits cost events on the first run of the day", async () => {
		const points: CapturedPoint[] = [];
		const env = createMockEnv({ insertChanges: 1, points });
		await runStorageAtRestCron({
			env: env as unknown as CloudflareBindings,
			now: new Date(Date.UTC(2026, 0, 15, 0, 0, 0)),
		});
		expect(points.length).toBeGreaterThan(0);
	});

	it("skips emission when the dedupe row already exists for today", async () => {
		const points: CapturedPoint[] = [];
		const env = createMockEnv({ insertChanges: 0, points });
		await runStorageAtRestCron({
			env: env as unknown as CloudflareBindings,
			now: new Date(Date.UTC(2026, 0, 15, 0, 0, 30)),
		});
		expect(points).toHaveLength(0);
	});

	it("fails closed if the dedupe insert throws (skips emission)", async () => {
		const points: CapturedPoint[] = [];
		const env: MockEnv = {
			KAYLE_ID_ANALYTICS: {
				writeDataPoint(p: CapturedPoint) {
					points.push(p);
				},
			},
			TRUST_STORE: {
				prepare() {
					return {
						bind() {
							return {
								async run() {
									throw new Error("d1 is sad today");
								},
							};
						},
					};
				},
			},
			CLOUDFLARE_API_TOKEN: "test-token",
			CLOUDFLARE_ACCOUNT_ID: "test-account",
		};
		await runStorageAtRestCron({
			env: env as unknown as CloudflareBindings,
			now: new Date(Date.UTC(2026, 0, 15, 0, 0, 0)),
		});
		expect(points).toHaveLength(0);
	});
});
