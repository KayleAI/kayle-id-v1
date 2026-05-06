import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import v1 from "@/v1";
import { UNVERIFIED_ORG_SESSION_LIMIT } from "@/v1/org-verification/rate-limit";
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
		.set({ verifiedAt })
		.where(eq(auth_organizations.id, organizationId));
}

async function createIdentitySession(apiKey: string): Promise<Response> {
	return v1.request("/sessions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
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

describe("/v1/sessions unverified-org rate limit", () => {
	test.serial(
		"Allows up to the limit, then rejects identity sessions for unverified orgs",
		async () => {
			if (!TEST_DATA) {
				throw new Error("TEST_DATA missing");
			}

			await clearSessionsForOrg(TEST_DATA.organizationId);
			await setOrgVerified(TEST_DATA.organizationId, null);

			for (let i = 0; i < UNVERIFIED_ORG_SESSION_LIMIT; i++) {
				const ok = await createIdentitySession(TEST_DATA.apiKey);
				expect(ok.status).toBe(200);
			}

			const blocked = await createIdentitySession(TEST_DATA.apiKey);
			expect(blocked.status).toBe(429);
			const payload = (await blocked.json()) as { error: { code: string } };
			expect(payload.error.code).toBe("ORG_NOT_VERIFIED_LIMIT_EXCEEDED");
		},
	);

	test.serial(
		"Age-only sessions are exempt and remain available after limit is hit",
		async () => {
			if (!TEST_DATA) {
				throw new Error("TEST_DATA missing");
			}

			// The org is still unverified and at the cap from the previous test.
			const ageOnly = await createAgeOnlySession(TEST_DATA.apiKey);
			expect(ageOnly.status).toBe(200);

			// Identity sessions still rejected.
			const blocked = await createIdentitySession(TEST_DATA.apiKey);
			expect(blocked.status).toBe(429);
		},
	);

	test.serial("Verified orgs bypass the limit entirely", async () => {
		if (!TEST_DATA) {
			throw new Error("TEST_DATA missing");
		}

		await setOrgVerified(TEST_DATA.organizationId, new Date());

		const ok = await createIdentitySession(TEST_DATA.apiKey);
		expect(ok.status).toBe(200);

		// Reset for any following tests.
		await setOrgVerified(TEST_DATA.organizationId, null);
		await clearSessionsForOrg(TEST_DATA.organizationId);
	});
});
