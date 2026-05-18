import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import v1 from "@/v1";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

async function clearSessionsForOrg(organizationId: string): Promise<void> {
	await db
		.delete(verification_sessions)
		.where(eq(verification_sessions.organizationId, organizationId));
}

async function setOrgVerified(
	organizationId: string,
	verifiedAt: Date | null,
): Promise<void> {
	await db
		.update(auth_organizations)
		.set({ owner_id_checked_at: verifiedAt })
		.where(eq(auth_organizations.id, organizationId));
}

async function createIdentitySession(apiKey: string): Promise<Response> {
	return v1.request("/sessions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});
}

async function createAgeOnlySession(apiKey: string): Promise<Response> {
	return v1.request("/sessions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			share_fields: {
				age_over_18: { required: true, reason: "Age verification" },
			},
		}),
	});
}

describe("/v1/sessions onboarding-gate vs unverified-org limit", () => {
	test.serial(
		"Identity sessions for an unverified org are blocked by the onboarding gate, not the legacy 5/24h limit",
		async () => {
			if (!TEST_DATA) {
				throw new Error("TEST_DATA missing");
			}

			await clearSessionsForOrg(TEST_DATA.organizationId);
			await setOrgVerified(TEST_DATA.organizationId, null);

			const blocked = await createIdentitySession(TEST_DATA.apiKey);
			expect(blocked.status).toBe(400);
			const payload = (await blocked.json()) as { error: { code: string } };
			expect(payload.error.code).toBe("ONBOARDING_INCOMPLETE");
		},
	);

	test.serial(
		"Age-only sessions are also blocked when the owner ID check step is incomplete",
		async () => {
			if (!TEST_DATA) {
				throw new Error("TEST_DATA missing");
			}

			// Org still unverified from previous test.
			const blocked = await createAgeOnlySession(TEST_DATA.apiKey);
			expect(blocked.status).toBe(400);
			const payload = (await blocked.json()) as { error: { code: string } };
			expect(payload.error.code).toBe("ONBOARDING_INCOMPLETE");
		},
	);

	test.serial(
		"Fully-onboarded orgs (owner_id_checked_at set) can create sessions normally",
		async () => {
			if (!TEST_DATA) {
				throw new Error("TEST_DATA missing");
			}

			await setOrgVerified(TEST_DATA.organizationId, new Date());

			const ok = await createIdentitySession(TEST_DATA.apiKey);
			expect(ok.status).toBe(200);

			// Reset for any following tests.
			await setOrgVerified(TEST_DATA.organizationId, new Date());
			await clearSessionsForOrg(TEST_DATA.organizationId);
		},
	);
});
