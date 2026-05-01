import { describe, expect, test } from "vitest";
import { buildApiProxyUrl, buildProxyHeaders } from "./proxy-internal-api";

describe("buildApiProxyUrl", () => {
	test("preserves the API service binding scheme", () => {
		expect(
			buildApiProxyUrl("https://verify.local/v1/verify/session/123?fresh=true"),
		).toBe("http://api/v1/verify/session/123?fresh=true");
	});

	test("resolves relative request URLs against the public host", () => {
		expect(
			buildApiProxyUrl("/v1/verify/session/123", "https://verify.local"),
		).toBe("http://api/v1/verify/session/123");
	});
});

describe("buildProxyHeaders", () => {
	test("forwards the Cloudflare connecting IP", () => {
		const headers = buildProxyHeaders(
			new Request("https://verify.local/v1/status", {
				headers: {
					"cf-connecting-ip": "203.0.113.10",
				},
			}),
		);

		expect(headers.get("x-forwarded-client-ip")).toBe("203.0.113.10");
	});

	test("falls back to the first forwarded IP", () => {
		const headers = buildProxyHeaders(
			new Request("https://verify.local/v1/status", {
				headers: {
					"x-forwarded-for": "198.51.100.20, 198.51.100.21",
				},
			}),
		);

		expect(headers.get("x-forwarded-client-ip")).toBe("198.51.100.20");
	});
});
