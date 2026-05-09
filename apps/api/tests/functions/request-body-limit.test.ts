import { expect, mock, test } from "bun:test";
import { API_REQUEST_BODY_LIMIT_BYTES } from "@/request-body-limit";

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

test("api rejects oversized request bodies before route validation", async () => {
	const { default: app } = await import("@/index");

	const response = await app.request(
		"/v1/verify/session/not-a-session/cancel",
		{
			body: "{}",
			headers: {
				"Content-Type": "application/json",
				"content-length": String(API_REQUEST_BODY_LIMIT_BYTES + 1),
			},
			method: "POST",
		},
	);

	expect(response.status).toBe(413);
	const payload = (await response.json()) as { error?: { code?: string } };
	expect(payload.error?.code).toBe("PAYLOAD_TOO_LARGE");
});
