import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	hardDeleteOrganizations,
	processDueOrganizationDeletions,
} from "@kayle-id/auth/organization-deletion";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
	auth_verifications,
} from "@kayle-id/database/schema/auth";
import { eq, inArray, like } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

const REQUEST_PATH = "/v1/auth/orgs/request-delete";
const CONFIRM_PATH = "/v1/auth/orgs/confirm-delete";
const CANCEL_PATH = "/v1/auth/orgs/cancel-delete";

let OWNER: SessionAuthTestData | undefined;
let ADMIN: SessionAuthTestData | undefined;
let MEMBER: SessionAuthTestData | undefined;

const createdOrganizationIds = new Set<string>();

function requireOwner(): SessionAuthTestData {
	if (!OWNER) {
		throw new Error("owner_missing");
	}
	return OWNER;
}

function requireAdmin(): SessionAuthTestData {
	if (!ADMIN) {
		throw new Error("admin_missing");
	}
	return ADMIN;
}

function requireMember(): SessionAuthTestData {
	if (!MEMBER) {
		throw new Error("member_missing");
	}
	return MEMBER;
}

async function createOrgWithMembers(): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(auth_organizations).values({
		createdAt: new Date(),
		id,
		name: `Test Org ${id}`,
		slug: `test-${id}`,
	});
	createdOrganizationIds.add(id);
	await db.insert(auth_organization_members).values([
		{
			createdAt: new Date(),
			organizationId: id,
			role: "owner",
			userId: requireOwner().userId,
		},
		{
			createdAt: new Date(),
			organizationId: id,
			role: "admin",
			userId: requireAdmin().userId,
		},
		{
			createdAt: new Date(),
			organizationId: id,
			role: "member",
			userId: requireMember().userId,
		},
	]);
	return id;
}

async function getVerificationForOrg(
	orgId: string,
	userId: string,
): Promise<{ value: string } | null> {
	const [row] = await db
		.select({ value: auth_verifications.value })
		.from(auth_verifications)
		.where(
			eq(
				auth_verifications.identifier,
				`org-delete-confirm:${orgId}:${userId}`,
			),
		)
		.limit(1);
	return row ?? null;
}

async function getOrg(
	orgId: string,
): Promise<typeof auth_organizations.$inferSelect | null> {
	const [row] = await db
		.select()
		.from(auth_organizations)
		.where(eq(auth_organizations.id, orgId))
		.limit(1);
	return row ?? null;
}

beforeAll(async () => {
	OWNER = await setupSessionAuth();
	ADMIN = await setupSessionAuth();
	MEMBER = await setupSessionAuth();
});

afterAll(async () => {
	if (createdOrganizationIds.size > 0) {
		await db
			.delete(auth_organizations)
			.where(inArray(auth_organizations.id, [...createdOrganizationIds]));
		createdOrganizationIds.clear();
	}
	// Clean any stray verification rows the tests may have left behind.
	await db
		.delete(auth_verifications)
		.where(like(auth_verifications.identifier, "org-delete-confirm:%"));
	await teardownSessionAuth(OWNER);
	OWNER = undefined;
	await teardownSessionAuth(ADMIN);
	ADMIN = undefined;
	await teardownSessionAuth(MEMBER);
	MEMBER = undefined;
});

describe("Organization deletion — request", () => {
	test("rejects requests without a session cookie", async () => {
		const response = await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: crypto.randomUUID() }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		expect(response.status).toBe(401);
	});

	test("rejects non-owners with 403", async () => {
		const orgId = await createOrgWithMembers();
		const adminResponse = await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireAdmin().sessionCookie,
			},
			method: "POST",
		});
		expect(adminResponse.status).toBe(403);

		const memberResponse = await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireMember().sessionCookie,
			},
			method: "POST",
		});
		expect(memberResponse.status).toBe(403);
	});

	test("owner can request → stores a verification row, leaves org unchanged", async () => {
		const orgId = await createOrgWithMembers();
		const response = await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		expect(response.status).toBe(200);

		const verification = await getVerificationForOrg(
			orgId,
			requireOwner().userId,
		);
		expect(verification).not.toBeNull();
		expect(verification?.value).toMatch(/^[A-Z0-9]{8}$/u);

		const org = await getOrg(orgId);
		expect(org?.pending_deletion_at).toBeNull();
	});

	test("re-requesting replaces the existing code", async () => {
		const orgId = await createOrgWithMembers();
		await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		const first = await getVerificationForOrg(orgId, requireOwner().userId);
		await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		const second = await getVerificationForOrg(orgId, requireOwner().userId);
		expect(second).not.toBeNull();
		expect(second?.value).not.toBe(first?.value);
	});
});

describe("Organization deletion — confirm", () => {
	test("rejects wrong code with 400", async () => {
		const orgId = await createOrgWithMembers();
		await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		const response = await app.request(CONFIRM_PATH, {
			body: JSON.stringify({ organizationId: orgId, code: "WRONGCOD" }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		expect(response.status).toBe(400);
		const org = await getOrg(orgId);
		expect(org?.pending_deletion_at).toBeNull();
	});

	test("correct code schedules deletion ~48h out and removes the verification row", async () => {
		const orgId = await createOrgWithMembers();
		await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		const verification = await getVerificationForOrg(
			orgId,
			requireOwner().userId,
		);
		expect(verification).not.toBeNull();

		const before = Date.now();
		const response = await app.request(CONFIRM_PATH, {
			body: JSON.stringify({
				organizationId: orgId,
				code: verification?.value,
			}),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		expect(response.status).toBe(200);

		const org = await getOrg(orgId);
		expect(org?.pending_deletion_at).not.toBeNull();
		const deltaMs = (org?.pending_deletion_at?.getTime() ?? 0) - before;
		// Allow a generous window for slow CI.
		expect(deltaMs).toBeGreaterThan(47 * 60 * 60 * 1000);
		expect(deltaMs).toBeLessThan(49 * 60 * 60 * 1000);
		expect(org?.pending_deletion_requested_by).toBe(requireOwner().userId);

		const stillThere = await getVerificationForOrg(
			orgId,
			requireOwner().userId,
		);
		expect(stillThere).toBeNull();
	});

	test("confirm by another user (admin) with the same code fails — code is per-requester", async () => {
		const orgId = await createOrgWithMembers();
		await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		const verification = await getVerificationForOrg(
			orgId,
			requireOwner().userId,
		);

		const response = await app.request(CONFIRM_PATH, {
			body: JSON.stringify({
				organizationId: orgId,
				code: verification?.value,
			}),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireAdmin().sessionCookie,
			},
			method: "POST",
		});
		// Admin is not an owner → 403.
		expect(response.status).toBe(403);
	});
});

describe("Organization deletion — cancel", () => {
	async function scheduleDeletion(orgId: string): Promise<void> {
		await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		const verification = await getVerificationForOrg(
			orgId,
			requireOwner().userId,
		);
		await app.request(CONFIRM_PATH, {
			body: JSON.stringify({
				organizationId: orgId,
				code: verification?.value,
			}),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
	}

	test("admin can cancel a scheduled deletion", async () => {
		const orgId = await createOrgWithMembers();
		await scheduleDeletion(orgId);
		const response = await app.request(CANCEL_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireAdmin().sessionCookie,
			},
			method: "POST",
		});
		expect(response.status).toBe(200);
		const org = await getOrg(orgId);
		expect(org?.pending_deletion_at).toBeNull();
		expect(org?.pending_deletion_requested_by).toBeNull();
	});

	test("member cannot cancel — 403", async () => {
		const orgId = await createOrgWithMembers();
		await scheduleDeletion(orgId);
		const response = await app.request(CANCEL_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireMember().sessionCookie,
			},
			method: "POST",
		});
		expect(response.status).toBe(403);
		const org = await getOrg(orgId);
		expect(org?.pending_deletion_at).not.toBeNull();
	});

	test("cancel on an org with no pending deletion → 404", async () => {
		const orgId = await createOrgWithMembers();
		const response = await app.request(CANCEL_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		expect(response.status).toBe(404);
	});
});

describe("Organization deletion — hard delete", () => {
	test("processDueOrganizationDeletions deletes due orgs", async () => {
		const doomedOrgId = await createOrgWithMembers();

		await db
			.update(auth_organizations)
			.set({
				pending_deletion_at: new Date(Date.now() - 1000),
				pending_deletion_requested_at: new Date(),
				pending_deletion_requested_by: requireOwner().userId,
			})
			.where(eq(auth_organizations.id, doomedOrgId));

		const result = await processDueOrganizationDeletions({
			now: new Date(),
		});
		expect(result.deleted).toContain(doomedOrgId);

		const doomed = await getOrg(doomedOrgId);
		expect(doomed).toBeNull();
		createdOrganizationIds.delete(doomedOrgId);
	});

	test("hardDeleteOrganizations on a never-frozen org cascades", async () => {
		const orgId = await createOrgWithMembers();

		await hardDeleteOrganizations([orgId]);
		createdOrganizationIds.delete(orgId);

		const stillThere = await getOrg(orgId);
		expect(stillThere).toBeNull();
	});
});

describe("Organization deletion — re-request blocked while scheduled", () => {
	test("requesting deletion of an already-scheduled org → 409", async () => {
		const orgId = await createOrgWithMembers();
		await db
			.update(auth_organizations)
			.set({
				pending_deletion_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
				pending_deletion_requested_at: new Date(),
				pending_deletion_requested_by: requireOwner().userId,
			})
			.where(eq(auth_organizations.id, orgId));

		const response = await app.request(REQUEST_PATH, {
			body: JSON.stringify({ organizationId: orgId }),
			headers: {
				"Content-Type": "application/json",
				Cookie: requireOwner().sessionCookie,
			},
			method: "POST",
		});
		expect(response.status).toBe(409);
	});
});
