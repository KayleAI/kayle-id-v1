import { expect, mock, test } from "bun:test";

mock.module("cloudflare:workers", () => ({
	WorkflowEntrypoint: class {
		ctx: unknown;
		env: unknown;

		constructor(ctx?: unknown, env?: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

test("api attaches the shared security headers to HTTPS responses", async () => {
	const { default: app } = await import("@/index");

	const response = await app.request("https://api.kayle.id/");

	expect(response.headers.get("Content-Security-Policy")).toBe(
		"base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
	);
	expect(response.headers.get("Permissions-Policy")).toBe(
		"camera=(), geolocation=(), microphone=(), payment=(), usb=()",
	);
	expect(response.headers.get("Referrer-Policy")).toBe(
		"strict-origin-when-cross-origin",
	);
	expect(response.headers.get("Strict-Transport-Security")).toBe(
		"max-age=31536000; includeSubDomains",
	);
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(response.headers.get("X-Frame-Options")).toBe("DENY");
});

test("api leaves HSTS off local HTTP responses", async () => {
	const { default: app } = await import("@/index");

	const response = await app.request("http://127.0.0.1:8787/");

	expect(response.headers.get("Strict-Transport-Security")).toBeNull();
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
