import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

let TEST_DATA: SessionAuthTestData | undefined;

const ORIGINAL_FETCH = globalThis.fetch;

beforeAll(async () => {
	TEST_DATA = await setupSessionAuth({ withActiveOrganization: true });
});

afterAll(async () => {
	await teardownSessionAuth(TEST_DATA);
	TEST_DATA = undefined;
	delete process.env.KAYLE_ORGANIZATION_ID;
	delete process.env.CLOUDFLARE_ACCOUNT_ID;
	delete process.env.CLOUDFLARE_API_TOKEN;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
});

function requireSessionData(): SessionAuthTestData & {
	organizationId: string;
} {
	if (!TEST_DATA?.organizationId) {
		throw new Error("session_auth_test_data_missing");
	}
	return TEST_DATA as SessionAuthTestData & { organizationId: string };
}

async function authorisedRequest(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const session = requireSessionData();
	process.env.KAYLE_ORGANIZATION_ID = session.organizationId;
	// `c.env` is wired from wrangler bindings in production; under
	// `app.request` we thread it through the third argument.
	return app.request(
		path,
		{
			...init,
			headers: {
				...(init.headers ?? {}),
				Cookie: session.sessionCookie,
			},
		},
		{
			CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
			CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
		},
	);
}

describe("/v1/admin/cost-analytics", () => {
	test("returns 401 when unauthenticated", async () => {
		process.env.KAYLE_ORGANIZATION_ID = crypto.randomUUID();
		const response = await app.request("/v1/admin/cost-analytics", {
			method: "GET",
		});
		expect(response.status).toBe(401);
	});

	test("returns 403 when active org does not match the admin org", async () => {
		const session = requireSessionData();
		// Force a non-matching admin org so the gate denies.
		process.env.KAYLE_ORGANIZATION_ID = crypto.randomUUID();
		const response = await app.request("/v1/admin/cost-analytics", {
			headers: { Cookie: session.sessionCookie },
			method: "GET",
		});
		expect(response.status).toBe(403);
	});

	test("returns 503 when CLOUDFLARE_ACCOUNT_ID is not configured", async () => {
		delete process.env.CLOUDFLARE_ACCOUNT_ID;
		delete process.env.CLOUDFLARE_API_TOKEN;
		const response = await authorisedRequest("/v1/admin/cost-analytics");
		expect(response.status).toBe(503);
		const payload = (await response.json()) as {
			error: { code: string };
		};
		expect(payload.error.code).toBe("ANALYTICS_MISCONFIGURED");
	});

	test("returns 400 on an invalid datetime range", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
		process.env.CLOUDFLARE_API_TOKEN = "test-token";
		const response = await authorisedRequest(
			"/v1/admin/cost-analytics?from=not-a-date&to=2026-05-08T00%3A00%3A00Z",
		);
		expect(response.status).toBe(400);
	});

	test("returns 400 when the range exceeds the 90-day cap", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
		process.env.CLOUDFLARE_API_TOKEN = "test-token";
		const response = await authorisedRequest(
			"/v1/admin/cost-analytics?from=2025-01-01T00%3A00%3A00Z&to=2025-12-31T00%3A00%3A00Z",
		);
		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string; message: string };
		};
		expect(payload.error.code).toBe("INVALID_RANGE");
	});

	test("returns 502 when the Cloudflare Analytics API rejects the query", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
		process.env.CLOUDFLARE_API_TOKEN = "test-token";
		// Only intercept the CF Analytics API call — Better Auth's session
		// validator hits Upstash via fetch and must keep working.
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.includes("analytics_engine/sql")) {
				return new Response("upstream is unhappy", { status: 500 });
			}
			return ORIGINAL_FETCH(input, init);
		}) as typeof fetch;
		const response = await authorisedRequest("/v1/admin/cost-analytics");
		expect(response.status).toBe(502);
		const payload = (await response.json()) as {
			error: { code: string };
		};
		expect(payload.error.code).toBe("ANALYTICS_QUERY_FAILED");
	});

	test("returns 200 with summed rows on a happy-path response", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
		process.env.CLOUDFLARE_API_TOKEN = "test-token";
		const seenUrls: string[] = [];
		const seenBodies: string[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			if (!url.includes("analytics_engine/sql")) {
				return ORIGINAL_FETCH(input, init);
			}
			seenUrls.push(url);
			seenBodies.push(String(init?.body ?? ""));
			return new Response(
				JSON.stringify({
					data: [
						{ group_key: "verify", cost_usd: 0.42, event_count: 100 },
						{ group_key: "webhook_delivery", cost_usd: 0.08, event_count: 25 },
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as typeof fetch;

		const response = await authorisedRequest(
			"/v1/admin/cost-analytics?groupBy=feature",
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				groupBy: string;
				totalCostUsd: number;
				rows: { groupKey: string; costUsd: number; count: number }[];
			};
		};
		expect(payload.data.groupBy).toBe("feature");
		expect(payload.data.rows).toHaveLength(2);
		expect(payload.data.rows[0]?.groupKey).toBe("verify");
		expect(payload.data.totalCostUsd).toBeCloseTo(0.5, 6);
		expect(seenUrls[0]).toContain("accounts/test-account");
		expect(seenBodies[0]).toContain("FROM KAYLE_ID_ANALYTICS");
	});
});
