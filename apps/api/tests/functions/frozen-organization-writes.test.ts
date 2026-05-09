import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";
import { createApiKeyRoute } from "@/auth/api-keys/create";
import uploadLogoRoute from "@/auth/organizations/logo";
import { createSession } from "@/openapi/v1/sessions/create";
import { denyFrozenOrgWrites } from "@/v1/auth";
import { createSessionHandler } from "@/v1/sessions/handlers/create-session";
import { createSessionValidationHook } from "@/v1/sessions/handlers/create-session-validation-hook";
import type { SessionsAppEnv } from "@/v1/sessions/types";
import webhooks from "@/v1/webhooks";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;

type TestAppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		organizationId: string;
		type: "session";
		userId: string;
	};
};

function requireTestData(): TestData {
	if (!TEST_DATA) {
		throw new Error("frozen_org_test_data_missing");
	}

	return TEST_DATA;
}

function createContextApp(): OpenAPIHono<TestAppEnv> {
	const testData = requireTestData();
	const app = new OpenAPIHono<TestAppEnv>();
	app.use(async (c, next) => {
		c.set("organizationId", testData.organizationId);
		c.set("type", "session");
		c.set("userId", testData.userId);
		return next();
	});
	return app;
}

function createSessionsApp(): OpenAPIHono<SessionsAppEnv> {
	const testData = requireTestData();
	const app = new OpenAPIHono<SessionsAppEnv>();
	app.use(async (c, next) => {
		c.set("organizationId", testData.organizationId);
		c.set("type", "session");
		return next();
	});
	app.openapi(createSession, createSessionHandler, createSessionValidationHook);
	return app;
}

function jsonHeaders(cookie: string): HeadersInit {
	return {
		"Content-Type": "application/json",
		Cookie: cookie,
	};
}

async function setOrgPendingDeletion(
	organizationId: string,
	pendingDeletionAt: Date | null,
): Promise<void> {
	await db
		.update(auth_organizations)
		.set({ pending_deletion_at: pendingDeletionAt })
		.where(eq(auth_organizations.id, organizationId));
}

async function expectFrozenResponse(response: Response): Promise<void> {
	expect(response.status).toBe(410);
	const payload = (await response.json()) as {
		error?: {
			code?: string;
		};
	};
	expect(payload.error?.code).toBe("ORGANIZATION_FROZEN");
}

beforeAll(async () => {
	TEST_DATA = await setup();
	await setOrgPendingDeletion(requireTestData().organizationId, new Date());
});

afterAll(async () => {
	if (TEST_DATA?.organizationId) {
		await setOrgPendingDeletion(TEST_DATA.organizationId, null);
	}
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

describe("frozen organization write guards", () => {
	test("blocks session-authenticated verification session creation", async () => {
		const response = await createSessionsApp().request("/", {
			method: "POST",
			headers: jsonHeaders("session=test"),
			body: JSON.stringify({}),
		});

		await expectFrozenResponse(response);
	});

	test("blocks session-authenticated API key creation", async () => {
		const app = createContextApp();
		app.use(denyFrozenOrgWrites());
		app.route("/", createApiKeyRoute);

		const response = await app.request("/", {
			method: "POST",
			headers: jsonHeaders("session=test"),
			body: JSON.stringify({
				name: "Frozen Org Key",
				permissions: ["sessions:write"],
			}),
		});

		await expectFrozenResponse(response);
	});

	test("blocks session-authenticated webhook endpoint creation", async () => {
		const app = createContextApp();
		app.route("/", webhooks);

		const response = await app.request("/endpoints", {
			method: "POST",
			headers: jsonHeaders("session=test"),
			body: JSON.stringify({
				name: "Frozen Org Webhook",
				url: "https://example.com/webhooks/frozen",
			}),
		});

		await expectFrozenResponse(response);
	});

	test("blocks session-authenticated organization logo upload", async () => {
		const app = createContextApp();
		app.route("/", uploadLogoRoute);

		const response = await app.request("/logo", {
			method: "POST",
			headers: jsonHeaders("session=test"),
			body: JSON.stringify({
				logo: {
					contentType: "image/png",
					data: "aW52YWxpZC1idXQtbm90LXJlYWQ=",
				},
			}),
		});

		await expectFrozenResponse(response);
	});
});
