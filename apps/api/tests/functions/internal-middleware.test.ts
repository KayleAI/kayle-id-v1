import { expect, test } from "bun:test";
import { Hono } from "hono";
import { requireInternalTrustToken } from "@/internal/middleware";

const INTERNAL_TOKEN =
	process.env.KAYLE_INTERNAL_TOKEN ?? "test-internal-token";

function createProtectedApp(): Hono {
	const app = new Hono();
	app.use(requireInternalTrustToken);
	app.post("/", (c) => c.json({ ok: true }));
	return app;
}

test("requireInternalTrustToken rejects missing bearer credentials", async () => {
	const response = await createProtectedApp().request("/", {
		method: "POST",
	});

	expect(response.status).toBe(401);
});

test("requireInternalTrustToken rejects wrong bearer credentials", async () => {
	const response = await createProtectedApp().request("/", {
		headers: {
			Authorization: "Bearer wrong-token",
		},
		method: "POST",
	});

	expect(response.status).toBe(401);
});

test("requireInternalTrustToken accepts the configured bearer credential", async () => {
	const response = await createProtectedApp().request("/", {
		headers: {
			Authorization: `Bearer ${INTERNAL_TOKEN}`,
		},
		method: "POST",
	});

	expect(response.status).toBe(200);
});
