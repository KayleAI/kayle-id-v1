import { describe, expect, test, vi } from "vitest";
import { DemoApiError } from "@/demo/api";
import {
	createDemoRateLimitKey,
	isDemoRateLimitKey,
	isDemoRunId,
	toErrorResponse,
} from "./-helpers";

// `-helpers.ts` imports `@/config/env`, which validates required platform
// secrets at module load time. The pure helpers exercised below don't
// touch env, so we stub the module to keep CI green without seeding
// KAYLE_INTERNAL_TOKEN et al. (vi.mock is hoisted above the imports above.)
vi.mock("@/config/env", () => ({ env: {} }));

describe("demo API helper errors", () => {
	test("preserves intended DemoApiError payloads", async () => {
		const response = toErrorResponse(
			new DemoApiError({
				code: "UPSTREAM_ERROR",
				hint: "Retry later.",
				message: "Demo upstream failed.",
				status: 502,
			}),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toEqual({
			data: null,
			error: {
				code: "UPSTREAM_ERROR",
				hint: "Retry later.",
				message: "Demo upstream failed.",
			},
		});
	});

	test("does not expose unexpected exception messages", async () => {
		const response = toErrorResponse(
			new Error("KAYLE_DEMO_API_KEY=secret leaked in stack"),
		);

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			data: null,
			error: {
				code: "INTERNAL_ERROR",
				message: "Unexpected demo error.",
			},
		});
	});
});

describe("demo run identifiers", () => {
	test("accepts generated demo run identifiers", () => {
		expect(isDemoRunId("demo_0123456789abcdef0123456789abcdef")).toBe(true);
	});

	test("rejects arbitrary Durable Object names", () => {
		expect(isDemoRunId("demo_0123456789ABCDEF0123456789ABCDEF")).toBe(false);
		expect(isDemoRunId("demo_0123456789abcdef")).toBe(false);
		expect(isDemoRunId("demo_../admin")).toBe(false);
		expect(isDemoRunId("custom-object-name")).toBe(false);
	});
});

describe("demo rate limit identifiers", () => {
	test("derives stable opaque keys from Cloudflare client IP metadata", async () => {
		const request = new Request("https://kayle.id/api/demo/runs", {
			headers: {
				"cf-connecting-ip": "203.0.113.10",
				"x-forwarded-for": "198.51.100.20",
			},
		});

		const key = await createDemoRateLimitKey({
			request,
			salt: "test-salt",
		});
		const repeatedKey = await createDemoRateLimitKey({
			request,
			salt: "test-salt",
		});

		expect(key).toBe(repeatedKey);
		expect(isDemoRateLimitKey(key)).toBe(true);
		expect(key).not.toContain("203.0.113.10");
		expect(key).not.toContain("198.51.100.20");
	});

	test("ignores spoofable forwarded headers when Cloudflare metadata is absent", async () => {
		const spoofed = await createDemoRateLimitKey({
			request: new Request("https://kayle.id/api/demo/runs", {
				headers: {
					"x-forwarded-for": "198.51.100.20",
				},
			}),
			salt: "test-salt",
		});
		const anonymous = await createDemoRateLimitKey({
			request: new Request("https://kayle.id/api/demo/runs"),
			salt: "test-salt",
		});

		expect(spoofed).toBe(anonymous);
	});

	test("rejects arbitrary Durable Object names as rate limit keys", () => {
		expect(isDemoRateLimitKey("demo_rate_not_hex")).toBe(false);
		expect(isDemoRateLimitKey("demo_0123456789abcdef0123456789abcdef")).toBe(
			false,
		);
	});
});
