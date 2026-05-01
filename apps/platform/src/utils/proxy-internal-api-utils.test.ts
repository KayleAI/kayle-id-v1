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
			),
		).toBe("http://api/v1/auth/session?fresh=true");
	});

	test("normalizes trailing and duplicate path separators without touching the scheme", () => {
		expect(
			buildInternalApiProxyUrl(
				"https://localhost:3000/api/webhooks//events//?limit=10",
			),
		).toBe("http://api/v1/webhooks/events?limit=10");
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

	test("forwards the first available client IP", () => {
		const headers = buildProxyHeaders(
			new Request("https://localhost:3000/api/auth/session", {
				headers: {
					"x-forwarded-for": "198.51.100.20, 198.51.100.21",
				},
			}),
			"test-token",
		);

		expect(headers.get("x-forwarded-client-ip")).toBe("198.51.100.20");
	});
});
