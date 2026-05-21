import { describe, expect, test } from "vitest";
import {
	buildApiProxyUrl,
	buildProxyHeaders,
	isAllowedApiProxyPath,
} from "./proxy";

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

describe("isAllowedApiProxyPath", () => {
	test("allows only the verify API namespace", () => {
		expect(
			isAllowedApiProxyPath(
				"https://verify.local/v1/verify/session/123/status",
			),
		).toBe(true);
		expect(isAllowedApiProxyPath("/v1/verify", "https://verify.local")).toBe(
			true,
		);
	});

	test("blocks unrelated API v1 namespaces on the verify domain", () => {
		expect(isAllowedApiProxyPath("https://verify.local/v1/auth/session")).toBe(
			false,
		);
		expect(isAllowedApiProxyPath("https://verify.local/v1/sessions")).toBe(
			false,
		);
		expect(
			isAllowedApiProxyPath("https://verify.local/v1/webhooks/events"),
		).toBe(false);
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

	test("does not promote raw x-forwarded-for without Cloudflare metadata", () => {
		const headers = buildProxyHeaders(
			new Request("https://verify.local/v1/status", {
				headers: {
					"x-forwarded-for": "198.51.100.20, 198.51.100.21",
				},
			}),
		);

		expect(headers.get("x-forwarded-client-ip")).toBeNull();
	});

	test("strips a client-supplied x-forwarded-client-ip when no source headers are present", () => {
		const headers = buildProxyHeaders(
			new Request("https://verify.local/v1/status", {
				headers: {
					"x-forwarded-client-ip": "203.0.113.99",
				},
			}),
		);

		expect(headers.get("x-forwarded-client-ip")).toBeNull();
	});

	test("overrides a client-supplied x-forwarded-client-ip with the proxy-derived IP", () => {
		const headers = buildProxyHeaders(
			new Request("https://verify.local/v1/status", {
				headers: {
					"cf-connecting-ip": "203.0.113.10",
					"x-forwarded-client-ip": "203.0.113.99",
				},
			}),
		);

		expect(headers.get("x-forwarded-client-ip")).toBe("203.0.113.10");
	});

	test("strips raw upstream source headers so the API never sees them", () => {
		const headers = buildProxyHeaders(
			new Request("https://verify.local/v1/status", {
				headers: {
					"cf-connecting-ip": "203.0.113.10",
					"x-forwarded-for": "198.51.100.99",
					"x-real-ip": "198.51.100.42",
				},
			}),
		);

		expect(headers.get("cf-connecting-ip")).toBeNull();
		expect(headers.get("x-real-ip")).toBeNull();
		expect(headers.get("x-forwarded-for")).toBeNull();
		expect(headers.get("x-forwarded-client-ip")).toBe("203.0.113.10");
	});

	test("does not promote a client-only x-real-ip / x-forwarded-for past the proxy", () => {
		const headers = buildProxyHeaders(
			new Request("https://verify.local/v1/status", {
				headers: {
					"x-forwarded-for": "198.51.100.99",
					"x-real-ip": "198.51.100.42",
				},
			}),
		);

		expect(headers.get("cf-connecting-ip")).toBeNull();
		expect(headers.get("x-real-ip")).toBeNull();
		expect(headers.get("x-forwarded-for")).toBeNull();
		expect(headers.get("x-forwarded-client-ip")).toBeNull();
	});
});
