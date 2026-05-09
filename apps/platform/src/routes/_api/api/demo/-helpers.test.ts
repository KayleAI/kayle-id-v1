import { describe, expect, test, vi } from "vitest";
import { DemoApiError } from "@/demo/api";
import { isDemoRunId, toErrorResponse } from "./-helpers";

vi.mock("cloudflare:workers", () => ({ env: {} }));

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
