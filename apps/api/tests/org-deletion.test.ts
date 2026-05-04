import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	hardDeleteOrganizations,
	processDueOrganizationDeletions,
} from "@kayle-id/auth/organization-deletion";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
	auth_sessions,
	auth_verifications,
} from "@kayle-id/database/schema/auth";
import { and, eq, inArray, like } from "drizzle-orm";
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
		expect(org?.pendingDeletionAt).toBeNull();
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
		expect(org?.pendingDeletionAt).toBeNull();
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
		expect(org?.pendingDeletionAt).not.toBeNull();
		const deltaMs = (org?.pendingDeletionAt?.getTime() ?? 0) - before;
		// Allow a generous window for slow CI.
		expect(deltaMs).toBeGreaterThan(47 * 60 * 60 * 1000);
		expect(deltaMs).toBeLessThan(49 * 60 * 60 * 1000);
		expect(org?.pendingDeletionRequestedBy).toBe(requireOwner().userId);

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
		expect(org?.pendingDeletionAt).toBeNull();
		expect(org?.pendingDeletionRequestedBy).toBeNull();
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
		expect(org?.pendingDeletionAt).not.toBeNull();
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

describe("Organization deletion — hard delete + active-org reassignment", () => {
	test("processDueOrganizationDeletions deletes due orgs and reassigns active sessions", async () => {
		// Make a doomed org and a fallback org for the owner.
		const doomedOrgId = await createOrgWithMembers();
		const fallbackOrgId = await createOrgWithMembers();

		// Mark the doomed org as overdue.
		await db
			.update(auth_organizations)
			.set({
				pendingDeletionAt: new Date(Date.now() - 1000),
				pendingDeletionRequestedAt: new Date(),
				pendingDeletionRequestedBy: requireOwner().userId,
			})
			.where(eq(auth_organizations.id, doomedOrgId));

		// Point one of the owner's sessions at the doomed org.
		await db
			.update(auth_sessions)
			.set({ activeOrganizationId: doomedOrgId })
			.where(eq(auth_sessions.userId, requireOwner().userId));

		const result = await processDueOrganizationDeletions({
			now: new Date(),
		});
		expect(result.deleted).toContain(doomedOrgId);

		// Doomed org gone
		const doomed = await getOrg(doomedOrgId);
		expect(doomed).toBeNull();
		createdOrganizationIds.delete(doomedOrgId);

		// Affected sessions should now point at the fallback (or null) — never at
		// the deleted org.
		const sessions = await db
			.select({ activeOrganizationId: auth_sessions.activeOrganizationId })
			.from(auth_sessions)
			.where(
				and(
					eq(auth_sessions.userId, requireOwner().userId),
					// We don't assert all sessions match — just that none point at the
					// deleted id.
				),
			);
		for (const s of sessions) {
			expect(s.activeOrganizationId).not.toBe(doomedOrgId);
		}
		// At least one should now be on the fallback org.
		const onFallback = sessions.some(
			(s) => s.activeOrganizationId === fallbackOrgId,
		);
		expect(onFallback).toBe(true);
	});

	test("hardDeleteOrganizations on a never-frozen org cascades and reassigns", async () => {
		const orgId = await createOrgWithMembers();
		const fallbackId = await createOrgWithMembers();

		await db
			.update(auth_sessions)
			.set({ activeOrganizationId: orgId })
			.where(eq(auth_sessions.userId, requireOwner().userId));

		await hardDeleteOrganizations([orgId]);
		createdOrganizationIds.delete(orgId);

		const stillThere = await getOrg(orgId);
		expect(stillThere).toBeNull();

		const sessions = await db
			.select({ activeOrganizationId: auth_sessions.activeOrganizationId })
			.from(auth_sessions)
			.where(eq(auth_sessions.userId, requireOwner().userId));
		const reassignedToFallback = sessions.some(
			(s) => s.activeOrganizationId === fallbackId,
		);
		expect(reassignedToFallback).toBe(true);
	});
});

describe("Organization deletion — re-request blocked while scheduled", () => {
	test("requesting deletion of an already-scheduled org → 409", async () => {
		const orgId = await createOrgWithMembers();
		await db
			.update(auth_organizations)
			.set({
				pendingDeletionAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
				pendingDeletionRequestedAt: new Date(),
				pendingDeletionRequestedBy: requireOwner().userId,
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
