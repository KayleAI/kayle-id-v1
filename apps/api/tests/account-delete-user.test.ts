import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { auth } from "@kayle-id/auth/server";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
	auth_users,
} from "@kayle-id/database/schema/auth";
import { api_keys } from "@kayle-id/database/schema/core";
import { eq, inArray } from "drizzle-orm";
import { API_KEY_SCOPES } from "@/auth/permissions";
import { createApiKey } from "@/functions/auth/create-api-key";
import app from "@/index";
import { type SessionAuthTestData, setupSessionAuth } from "./session-auth";

type DeleteUserResponse = {
	success?: boolean;
	message?: string;
};

const trackedUserIds = new Set<string>();
const trackedOrgIds = new Set<string>();
const trackedApiKeyIds = new Set<string>();

async function createOrganization(): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(auth_organizations).values({
		createdAt: new Date(),
		id,
		name: `Delete-User Test Org ${id}`,
		slug: `dui-${id}`,
	});
	trackedOrgIds.add(id);
	return id;
}

async function addMember({
	organizationId,
	role,
	userId,
}: {
	organizationId: string;
	role: string;
	userId: string;
}): Promise<void> {
	await db.insert(auth_organization_members).values({
		createdAt: new Date(),
		organizationId,
		role,
		userId,
	});
}

async function trackSession(
	session: SessionAuthTestData,
): Promise<SessionAuthTestData> {
	trackedUserIds.add(session.userId);
	return session;
}

// Verification tokens are written to the secondary storage (Redis) when one is
// configured, with no DB fallback unless `verification.storeInDatabase` is on,
// so we can't look the token up in `auth_verifications`. Instead, we monkey-
// patch `sendDeleteAccountVerification` per-test to capture the URL the route
// hands to the email sender.
const deleteUserConfig = (() => {
	const config = auth.options.user?.deleteUser;
	if (!config) {
		throw new Error("delete_user_config_missing");
	}
	return config;
})();
const originalSendDeleteAccountVerification =
	deleteUserConfig.sendDeleteAccountVerification;

function captureNextDeleteAccountVerification(): Promise<{ token: string }> {
	return new Promise((resolve) => {
		deleteUserConfig.sendDeleteAccountVerification = async ({ token }) => {
			resolve({ token });
		};
	});
}

afterEach(() => {
	if (originalSendDeleteAccountVerification) {
		deleteUserConfig.sendDeleteAccountVerification =
			originalSendDeleteAccountVerification;
	}
});

afterAll(async () => {
	if (trackedApiKeyIds.size > 0) {
		await db
			.delete(api_keys)
			.where(inArray(api_keys.id, [...trackedApiKeyIds]));
		trackedApiKeyIds.clear();
	}
	if (trackedOrgIds.size > 0) {
		await db
			.delete(auth_organizations)
			.where(inArray(auth_organizations.id, [...trackedOrgIds]));
		trackedOrgIds.clear();
	}
	if (trackedUserIds.size > 0) {
		await db
			.delete(auth_users)
			.where(inArray(auth_users.id, [...trackedUserIds]));
		trackedUserIds.clear();
	}
});

describe("Account — delete-user", () => {
	let SOLE_OWNER: SessionAuthTestData;
	let CO_OWNER_A: SessionAuthTestData;
	let CO_OWNER_B: SessionAuthTestData;
	let SOLE_OWNED_ORG_ID: string;
	let CO_OWNED_ORG_ID: string;
	let SOLE_OWNED_API_KEY_ID: string;
	let CO_OWNED_API_KEY_ID: string;

	beforeAll(async () => {
		SOLE_OWNER = await trackSession(await setupSessionAuth());
		CO_OWNER_A = await trackSession(await setupSessionAuth());
		CO_OWNER_B = await trackSession(await setupSessionAuth());

		SOLE_OWNED_ORG_ID = await createOrganization();
		await addMember({
			organizationId: SOLE_OWNED_ORG_ID,
			role: "owner,admin",
			userId: SOLE_OWNER.userId,
		});

		CO_OWNED_ORG_ID = await createOrganization();
		await addMember({
			organizationId: CO_OWNED_ORG_ID,
			role: "owner",
			userId: CO_OWNER_A.userId,
		});
		await addMember({
			organizationId: CO_OWNED_ORG_ID,
			role: "owner",
			userId: CO_OWNER_B.userId,
		});

		const soleOwnedKey = await createApiKey({
			name: "Sole-owned key",
			organizationId: SOLE_OWNED_ORG_ID,
			permissions: [...API_KEY_SCOPES],
		});
		SOLE_OWNED_API_KEY_ID = soleOwnedKey.id;
		trackedApiKeyIds.add(soleOwnedKey.id);

		const coOwnedKey = await createApiKey({
			name: "Co-owned key",
			organizationId: CO_OWNED_ORG_ID,
			permissions: [...API_KEY_SCOPES],
		});
		CO_OWNED_API_KEY_ID = coOwnedKey.id;
		trackedApiKeyIds.add(coOwnedKey.id);
	});

	test("cascades sole-owned org (with api keys) and leaves co-owned org intact", async () => {
		const captured = captureNextDeleteAccountVerification();

		const triggerResponse = await app.request("/v1/auth/delete-user", {
			body: JSON.stringify({}),
			headers: {
				"Content-Type": "application/json",
				Cookie: SOLE_OWNER.sessionCookie,
			},
			method: "POST",
		});
		expect(triggerResponse.status).toBe(200);
		const triggerPayload = (await triggerResponse.json()) as DeleteUserResponse;
		expect(triggerPayload).toEqual({
			success: true,
			message: "Verification email sent",
		});

		const { token } = await captured;

		const callbackResponse = await app.request(
			`/v1/auth/delete-user/callback?token=${token}`,
			{
				headers: { Cookie: SOLE_OWNER.sessionCookie },
				method: "GET",
			},
		);
		expect(callbackResponse.status).toBe(200);

		// User row gone.
		const userRows = await db
			.select({ id: auth_users.id })
			.from(auth_users)
			.where(eq(auth_users.id, SOLE_OWNER.userId));
		expect(userRows).toHaveLength(0);

		// Sole-owned org and its api key cascaded out.
		const soleOrgRows = await db
			.select({ id: auth_organizations.id })
			.from(auth_organizations)
			.where(eq(auth_organizations.id, SOLE_OWNED_ORG_ID));
		expect(soleOrgRows).toHaveLength(0);
		const soleKeyRows = await db
			.select({ id: api_keys.id })
			.from(api_keys)
			.where(eq(api_keys.id, SOLE_OWNED_API_KEY_ID));
		expect(soleKeyRows).toHaveLength(0);
		trackedOrgIds.delete(SOLE_OWNED_ORG_ID);
		trackedApiKeyIds.delete(SOLE_OWNED_API_KEY_ID);
		trackedUserIds.delete(SOLE_OWNER.userId);

		// Co-owned org survives — co-owner B still has a membership row.
		const coOrgRows = await db
			.select({ id: auth_organizations.id })
			.from(auth_organizations)
			.where(eq(auth_organizations.id, CO_OWNED_ORG_ID));
		expect(coOrgRows).toEqual([{ id: CO_OWNED_ORG_ID }]);
		const coKeyRows = await db
			.select({ id: api_keys.id })
			.from(api_keys)
			.where(eq(api_keys.id, CO_OWNED_API_KEY_ID));
		expect(coKeyRows).toEqual([{ id: CO_OWNED_API_KEY_ID }]);
	});
});
