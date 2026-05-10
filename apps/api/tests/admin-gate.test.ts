import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

let TEST_DATA: SessionAuthTestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setupSessionAuth({ withActiveOrganization: true });
});

afterAll(async () => {
	await teardownSessionAuth(TEST_DATA);
	TEST_DATA = undefined;
	delete process.env.KAYLE_ORGANIZATION_ID;
});

function require_session_data(): SessionAuthTestData & {
	organizationId: string;
} {
	if (!TEST_DATA?.organizationId) {
		throw new Error("session_auth_test_data_missing");
	}
	return TEST_DATA as SessionAuthTestData & { organizationId: string };
}

describe("Platform admin gate (/v1/admin)", () => {
	test("returns 401 for an unauthenticated request", async () => {
		process.env.KAYLE_ORGANIZATION_ID = crypto.randomUUID();
		const response = await app.request("/v1/admin/access", { method: "GET" });
		expect(response.status).toBe(401);
	});

	test("returns 403 when active org does not match KAYLE_ORGANIZATION_ID", async () => {
		const session = require_session_data();
		// Set the env to a UUID that's definitely not this session's org.
		process.env.KAYLE_ORGANIZATION_ID = crypto.randomUUID();

		const response = await app.request("/v1/admin/access", {
			headers: { Cookie: session.sessionCookie },
			method: "GET",
		});
		expect(response.status).toBe(403);
	});

	test("returns 403 when KAYLE_ORGANIZATION_ID is unset (no admin org)", async () => {
		const session = require_session_data();
		delete process.env.KAYLE_ORGANIZATION_ID;

		const response = await app.request("/v1/admin/access", {
			headers: { Cookie: session.sessionCookie },
			method: "GET",
		});
		expect(response.status).toBe(403);
	});

	test("returns 200 with permitted=true when active org matches", async () => {
		const session = require_session_data();
		process.env.KAYLE_ORGANIZATION_ID = session.organizationId;

		const response = await app.request("/v1/admin/access", {
			headers: { Cookie: session.sessionCookie },
			method: "GET",
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: { permitted: boolean };
		};
		expect(payload.data.permitted).toBe(true);
	});
});
