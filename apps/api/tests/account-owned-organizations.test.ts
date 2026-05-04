import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { inArray } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

type OwnedOrganizationsResponse = {
	data: null | {
		organizations: Array<{
			id: string;
			name: string;
			slug: string;
		}>;
	};
	error: null | {
		code: string;
		message: string;
	};
};

let CALLER: SessionAuthTestData | undefined;
let CO_OWNER: SessionAuthTestData | undefined;
const createdOrganizationIds: string[] = [];

function requireCaller(): SessionAuthTestData {
	if (!CALLER) {
		throw new Error("account_owned_organizations_caller_missing");
	}
	return CALLER;
}

function requireCoOwner(): SessionAuthTestData {
	if (!CO_OWNER) {
		throw new Error("account_owned_organizations_co_owner_missing");
	}
	return CO_OWNER;
}

async function createOrganization(): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(auth_organizations).values({
		createdAt: new Date(),
		id,
		name: `Test Org ${id}`,
		slug: `test-${id}`,
	});
	createdOrganizationIds.push(id);
	return id;
}

async function addMember({
	organizationId,
	userId,
	role,
}: {
	organizationId: string;
	userId: string;
	role: "owner" | "admin" | "member";
}): Promise<void> {
	await db.insert(auth_organization_members).values({
		createdAt: new Date(),
		organizationId,
		role,
		userId,
	});
}

beforeAll(async () => {
	CALLER = await setupSessionAuth();
	CO_OWNER = await setupSessionAuth();
});

afterAll(async () => {
	if (createdOrganizationIds.length > 0) {
		await db
			.delete(auth_organizations)
			.where(inArray(auth_organizations.id, [...createdOrganizationIds]));
		createdOrganizationIds.length = 0;
	}

	await teardownSessionAuth(CALLER);
	CALLER = undefined;
	await teardownSessionAuth(CO_OWNER);
	CO_OWNER = undefined;
});

describe("Account — owned-organizations endpoint", () => {
	test("returns 401 without a session cookie", async () => {
		const response = await app.request("/v1/auth/account/owned-organizations", {
			method: "GET",
		});

		expect(response.status).toBe(401);
	});

	test("returns sole-owned org and excludes co-owned, admin, and member orgs", async () => {
		const caller = requireCaller();
		const coOwner = requireCoOwner();

		const soleOwnedId = await createOrganization();
		await addMember({
			organizationId: soleOwnedId,
			userId: caller.userId,
			role: "owner",
		});

		const coOwnedId = await createOrganization();
		await addMember({
			organizationId: coOwnedId,
			userId: caller.userId,
			role: "owner",
		});
		await addMember({
			organizationId: coOwnedId,
			userId: coOwner.userId,
			role: "owner",
		});

		const adminOrgId = await createOrganization();
		await addMember({
			organizationId: adminOrgId,
			userId: caller.userId,
			role: "admin",
		});
		await addMember({
			organizationId: adminOrgId,
			userId: coOwner.userId,
			role: "owner",
		});

		const memberOrgId = await createOrganization();
		await addMember({
			organizationId: memberOrgId,
			userId: caller.userId,
			role: "member",
		});
		await addMember({
			organizationId: memberOrgId,
			userId: coOwner.userId,
			role: "owner",
		});

		const response = await app.request("/v1/auth/account/owned-organizations", {
			headers: { Cookie: caller.sessionCookie },
			method: "GET",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as OwnedOrganizationsResponse;
		expect(payload.error).toBeNull();
		const ids =
			payload.data?.organizations.map((org) => org.id).toSorted() ?? [];
		expect(ids).toEqual([soleOwnedId]);
	});
});
