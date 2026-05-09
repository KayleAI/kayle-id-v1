import { expect, test } from "bun:test";
import { Hono } from "hono";
import { buildBetterAuthRequest } from "@/auth";
import { createHMAC } from "@/functions/hmac";
import { authenticate } from "@/v1/auth";

function createAuthenticatedApp(): Hono {
	const app = new Hono();
	app.use(authenticate);
	app.get("/", (c) => c.json({ ok: true }));
	return app;
}

test("authenticate rejects an empty bearer token without falling through", async () => {
	const response = await createAuthenticatedApp().request("/", {
		headers: {
			Authorization: "Bearer   ",
		},
	});

	expect(response.status).toBe(401);

	const payload = (await response.json()) as {
		error?: {
			code?: string;
		};
	};
	expect(payload.error?.code).toBe("UNAUTHORIZED");
});

test("Better Auth request adapter drops spoofed forwarded client IP headers", async () => {
	const request = await buildBetterAuthRequest({
		internalToken: "test-token",
		request: new Request("https://api.kayle.id/v1/auth/sign-in", {
			headers: {
				"cf-connecting-ip": "203.0.113.10",
				"x-forwarded-client-ip": "198.51.100.99",
				"x-forwarded-for": "198.51.100.42",
				"x-real-ip": "198.51.100.43",
			},
		}),
	});

	expect(request.headers.get("x-forwarded-client-ip")).toBe("203.0.113.10");
	expect(request.headers.get("cf-connecting-ip")).toBeNull();
	expect(request.headers.get("x-forwarded-for")).toBeNull();
	expect(request.headers.get("x-real-ip")).toBeNull();
});

test("Better Auth request adapter preserves signed platform proxy client IP", async () => {
	const serializedCf = JSON.stringify({ city: "London" });
	const signature = await createHMAC(serializedCf, {
		algorithm: "SHA256",
		secret: "test-token",
	});

	const request = await buildBetterAuthRequest({
		internalToken: "test-token",
		request: new Request("https://api.kayle.id/v1/auth/session", {
			headers: {
				"cf-connecting-ip": "203.0.113.10",
				"x-cf-geolocation": btoa(serializedCf),
				"x-cf-signature": signature,
				"x-forwarded-client-ip": "198.51.100.20",
			},
		}),
	});

	expect(request.headers.get("x-forwarded-client-ip")).toBe("198.51.100.20");
	expect(request.headers.get("cf-connecting-ip")).toBeNull();
	expect(request.headers.get("x-cf-geolocation")).toBeNull();
	expect(request.headers.get("x-cf-signature")).toBeNull();
});
