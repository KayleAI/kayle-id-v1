import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
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
};

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
			verifiedAt: new Date(),
			verificationTermsAcceptedAt: new Date(),
			verificationTermsAcceptedBy: userId,
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

	const { apiKey, id: apiKeyId } = await createApiKey({
		name: "Test API Key",
		organizationId,
		permissions: [...CUSTOMER_API_KEY_SCOPES],
	});

	return { userId, organizationId, apiKey, apiKeyId };
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
