import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	buildInternalApiProxyUrl,
	buildProxyHeaders,
} from "./proxy-internal-api-utils";

describe("buildInternalApiProxyUrl", () => {
	test("maps public api requests to the internal v1 service binding URL", () => {
		expect(
			buildInternalApiProxyUrl(
				"https://localhost:3000/api/auth/session?fresh=true",
				"auth",
			),
		).toBe("http://api/v1/auth/session?fresh=true");
	});

	test("normalizes trailing and duplicate path separators without touching the scheme", () => {
		expect(
			buildInternalApiProxyUrl(
				"https://localhost:3000/api/webhooks//events//?limit=10",
				"webhooks",
			),
		).toBe("http://api/v1/webhooks/events?limit=10");
	});

	test("rejects paths that normalized outside the route proxy root", () => {
		expect(() =>
			buildInternalApiProxyUrl(
				"https://localhost:3000/api/auth/%2e%2e/internal/auth/check-session-membership",
				"auth",
			),
		).toThrow("internal_api_proxy_path_mismatch");
	});

	test("rejects requests for a different proxy root", () => {
		expect(() =>
			buildInternalApiProxyUrl(
				"https://localhost:3000/api/internal/auth/check-session-membership",
				"webhooks",
			),
		).toThrow("internal_api_proxy_path_mismatch");
	});
});

describe("buildProxyHeaders", () => {
	test("signs Cloudflare geolocation metadata", () => {
		const cf = { city: "London", country: "GB" };
		const headers = buildProxyHeaders(
			Object.assign(new Request("https://localhost:3000/api/auth/session"), {
				cf,
			}),
			"test-token",
		);
		const serializedCf = JSON.stringify(cf);

		expect(headers.get("x-cf-geolocation")).toBe(btoa(serializedCf));
		expect(headers.get("x-cf-signature")).toBe(
			createHmac("sha256", "test-token").update(serializedCf).digest("hex"),
		);
	});

	test("does not promote raw x-forwarded-for without Cloudflare metadata", () => {
		const headers = buildProxyHeaders(
			new Request("https://localhost:3000/api/auth/session", {
				headers: {
					"x-forwarded-for": "198.51.100.20, 198.51.100.21",
				},
			}),
			"test-token",
		);

		expect(headers.get("x-forwarded-client-ip")).toBeNull();
	});

	test("strips client-supplied trusted proxy headers when no upstream metadata is present", () => {
		const headers = buildProxyHeaders(
			new Request("https://localhost:3000/api/auth/session", {
				headers: {
					"x-cf-geolocation": btoa('{"city":"Spoofed"}'),
					"x-cf-signature": "deadbeef",
					"x-forwarded-client-ip": "203.0.113.99",
				},
			}),
			"test-token",
		);

		expect(headers.get("x-forwarded-client-ip")).toBeNull();
		expect(headers.get("x-cf-geolocation")).toBeNull();
		expect(headers.get("x-cf-signature")).toBeNull();
	});

	test("overrides spoofed proxy headers with worker-derived metadata", () => {
		const cf = { city: "London" };
		const headers = buildProxyHeaders(
			Object.assign(
				new Request("https://localhost:3000/api/auth/session", {
					headers: {
						"cf-connecting-ip": "203.0.113.10",
						"x-cf-geolocation": btoa('{"city":"Spoofed"}'),
						"x-cf-signature": "deadbeef",
						"x-forwarded-client-ip": "203.0.113.99",
					},
				}),
				{ cf },
			),
			"test-token",
		);

		expect(headers.get("x-forwarded-client-ip")).toBe("203.0.113.10");
		expect(headers.get("x-cf-geolocation")).toBe(btoa(JSON.stringify(cf)));
		expect(headers.get("x-cf-signature")).toBe(
			createHmac("sha256", "test-token")
				.update(JSON.stringify(cf))
				.digest("hex"),
		);
	});

	test("strips raw upstream source IP headers so the API never sees them", () => {
		const headers = buildProxyHeaders(
			new Request("https://localhost:3000/api/auth/session", {
				headers: {
					"cf-connecting-ip": "203.0.113.10",
					"x-forwarded-for": "198.51.100.99",
					"x-real-ip": "198.51.100.42",
				},
			}),
			"test-token",
		);

		expect(headers.get("cf-connecting-ip")).toBeNull();
		expect(headers.get("x-real-ip")).toBeNull();
		expect(headers.get("x-forwarded-for")).toBeNull();
		expect(headers.get("x-forwarded-client-ip")).toBe("203.0.113.10");
	});

	test("does not forward client-supplied x-real-ip / x-forwarded-for past the proxy", () => {
		const headers = buildProxyHeaders(
			new Request("https://localhost:3000/api/auth/session", {
				headers: {
					"x-forwarded-for": "198.51.100.99",
					"x-real-ip": "198.51.100.42",
				},
			}),
			"test-token",
		);

		expect(headers.get("cf-connecting-ip")).toBeNull();
		expect(headers.get("x-real-ip")).toBeNull();
		expect(headers.get("x-forwarded-for")).toBeNull();
		expect(headers.get("x-forwarded-client-ip")).toBeNull();
	});
});
