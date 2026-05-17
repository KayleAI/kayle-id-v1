import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organization_verified_domains,
	auth_organizations,
	auth_users,
} from "@kayle-id/database/schema/auth";
import { api_keys } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { CUSTOMER_API_KEY_SCOPES } from "@/auth/permissions";
import { createApiKey } from "@/functions/auth/create-api-key";

type TestData = {
	userId: string;
	organizationId: string;
	apiKey: string;
	apiKeyId: string;
	verifiedApexDomains: readonly [string, string];
};

/**
 * Generate two per-org-unique apex domains and pre-verify them. Tests that
 * need to assert against the apex (e.g. verify-handoff) read these off the
 * returned `TestData` so we don't collide with other parallel test files
 * under the global-unique-active-apex constraint on
 * `auth_organization_verified_domains`.
 */
function makeTestVerifiedApexDomains(): readonly [string, string] {
	// Both labels need to land at apex (eTLD+1) under the apex extractor.
	// `.invalid` is reserved per RFC 6761, so `<random>-a.invalid` is exactly
	// the apex — collisions across parallel test files are vanishingly
	// unlikely with a 12-char random prefix.
	const slug = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
	return [`${slug}a.invalid`, `${slug}b.invalid`];
}

const setup = async (): Promise<TestData> => {
	const [createdUser] = await db
		.insert(auth_users)
		.values({
			id: crypto.randomUUID(),
			email: `${crypto.randomUUID()}@test.kayle.id`,
			name: `Test User ${crypto.randomUUID()}`,
		})
		.returning({
			id: auth_users.id,
		})
		.onConflictDoNothing();

	if (!createdUser?.id) {
		throw new Error("Failed to create user");
	}

	const userId = createdUser.id;

	const [createdOrganization] = await db
		.insert(auth_organizations)
		.values({
			id: crypto.randomUUID(),
			name: "Test Organization",
			slug: `test-${crypto.randomUUID()}`,
			createdAt: new Date(),
			// Seed the test org as verified so the unverified-org rate limit
			// doesn't cap test fixtures at 5 identity sessions per file. Tests
			// that explicitly exercise the unverified path (see
			// `sessions-unverified-org-limit.test.ts`) toggle this back to null.
			owner_id_checked_at: new Date(),
			verification_terms_accepted_at: new Date(),
			verification_terms_accepted_by: userId,
		})
		.returning({
			id: auth_organizations.id,
		});

	if (!createdOrganization?.id) {
		throw new Error("Failed to create organization");
	}

	const organizationId = createdOrganization.id;

	await db.insert(auth_organization_members).values({
		organizationId,
		createdAt: new Date(),
		userId,
		role: "owner",
	});

	const verifiedApexDomains = makeTestVerifiedApexDomains();
	const baseNow = Date.now();
	await db.insert(auth_organization_verified_domains).values(
		verifiedApexDomains.map((apexDomain, index) => {
			const verifiedAt = new Date(
				baseNow + (verifiedApexDomains.length - 1 - index),
			);
			return {
				organizationId,
				apexDomain,
				verifiedAt,
				verifiedVia: "dns_txt" as const,
				verifiedBy: userId,
				recheckToken: "test-fixture-token",
				lastCheckedAt: verifiedAt,
			};
		}),
	);

	const { apiKey, id: apiKeyId } = await createApiKey({
		name: "Test API Key",
		organizationId,
		permissions: [...CUSTOMER_API_KEY_SCOPES],
	});

	return { userId, organizationId, apiKey, apiKeyId, verifiedApexDomains };
};

const teardown = async (testData?: TestData): Promise<void> => {
	if (!testData) {
		return;
	}

	await db.delete(auth_users).where(eq(auth_users.id, testData.userId));
	await db
		.delete(auth_organizations)
		.where(eq(auth_organizations.id, testData.organizationId));
	await db.delete(api_keys).where(eq(api_keys.id, testData.apiKeyId));
};

export { setup, type TestData, teardown };
