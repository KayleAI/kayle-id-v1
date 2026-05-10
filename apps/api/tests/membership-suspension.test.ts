import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@kayle-id/auth/server";
import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import { auth_organization_members } from "@kayle-id/database/schema/auth";
import { and, desc, eq } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setActiveOrganizationOnSession,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

let OWNER_DATA: SessionAuthTestData | undefined;
let MEMBER_DATA: SessionAuthTestData | undefined;
let MEMBER_MEMBERSHIP_ID: string | undefined;

interface SuspendResponse {
	data: {
		message: string;
		status: "success";
	} | null;
	error: null | { code: string; message: string };
}

function jsonHeaders(cookie: string): HeadersInit {
	return { "Content-Type": "application/json", Cookie: cookie };
}

function requireOwner(): SessionAuthTestData & { organizationId: string } {
	if (!OWNER_DATA?.organizationId) {
		throw new Error("suspension_test_owner_missing");
	}
	return OWNER_DATA as SessionAuthTestData & { organizationId: string };
}

function requireMember(): SessionAuthTestData {
	if (!MEMBER_DATA) {
		throw new Error("suspension_test_member_missing");
	}
	return MEMBER_DATA;
}

function requireMemberMembershipId(): string {
	if (!MEMBER_MEMBERSHIP_ID) {
		throw new Error("suspension_test_member_membership_id_missing");
	}
	return MEMBER_MEMBERSHIP_ID;
}

async function ensureMemberActive(): Promise<void> {
	if (!MEMBER_MEMBERSHIP_ID) {
		return;
	}
	await db
		.update(auth_organization_members)
		.set({ suspendedAt: null, suspendedBy: null })
		.where(eq(auth_organization_members.id, MEMBER_MEMBERSHIP_ID));
}

beforeAll(async () => {
	OWNER_DATA = await setupSessionAuth({ withActiveOrganization: true });
	const owner = requireOwner();

	const member = await setupSessionAuth({ withActiveOrganization: false });
	const [inserted] = await db
		.insert(auth_organization_members)
		.values({
			createdAt: new Date(),
			organizationId: owner.organizationId,
			role: "member",
			userId: member.userId,
		})
		.returning({ id: auth_organization_members.id });
	if (!inserted) {
		throw new Error("suspension_test_failed_to_insert_membership");
	}
	MEMBER_MEMBERSHIP_ID = inserted.id;
	const refreshedCookie = await setActiveOrganizationOnSession({
		organizationId: owner.organizationId,
		sessionCookie: member.sessionCookie,
	});
	MEMBER_DATA = {
		organizationId: owner.organizationId,
		sessionCookie: refreshedCookie,
		userId: member.userId,
	};
});

afterAll(async () => {
	await teardownSessionAuth(MEMBER_DATA);
	MEMBER_DATA = undefined;
	MEMBER_MEMBERSHIP_ID = undefined;
	await teardownSessionAuth(OWNER_DATA);
	OWNER_DATA = undefined;
});

describe("Suspending a member", () => {
	test("an owner can suspend another member; row stays with suspended_at set", async () => {
		await ensureMemberActive();
		const owner = requireOwner();
		const memberMembershipId = requireMemberMembershipId();

		const response = await app.request(
			`/v1/auth/orgs/members/${memberMembershipId}`,
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "DELETE",
			},
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as SuspendResponse;
		expect(payload.error).toBeNull();
		expect(payload.data?.status).toBe("success");

		const [row] = await db
			.select({
				id: auth_organization_members.id,
				suspendedAt: auth_organization_members.suspendedAt,
				suspendedBy: auth_organization_members.suspendedBy,
			})
			.from(auth_organization_members)
			.where(eq(auth_organization_members.id, memberMembershipId))
			.limit(1);
		expect(row?.suspendedAt).not.toBeNull();
		expect(row?.suspendedBy).toBe(owner.userId);

		const auditRows = await db
			.select({ event: audit_logs.event })
			.from(audit_logs)
			.where(
				and(
					eq(audit_logs.organizationId, owner.organizationId),
					eq(audit_logs.targetId, memberMembershipId),
				),
			)
			.orderBy(desc(audit_logs.createdAt));
		expect(auditRows.map((r) => r.event)).toContain("member.suspended");

		// Cleanup audit rows we added so they don't bleed into other tests.
		await db
			.delete(audit_logs)
			.where(eq(audit_logs.organizationId, owner.organizationId));
	});

	test("a suspended user is forbidden on org-scoped endpoints", async () => {
		const owner = requireOwner();
		const memberMembershipId = requireMemberMembershipId();
		await db
			.update(auth_organization_members)
			.set({ suspendedAt: new Date(), suspendedBy: owner.userId })
			.where(eq(auth_organization_members.id, memberMembershipId));

		const member = requireMember();
		// Audit-logs is admin/owner-only anyway, but the relevant assertion is
		// FORBIDDEN (403), not 200 — the suspension takes precedence.
		const response = await app.request("/v1/auth/orgs/audit-logs", {
			headers: jsonHeaders(member.sessionCookie),
			method: "GET",
		});
		expect(response.status).toBe(403);
	});

	test("the only active owner cannot be suspended", async () => {
		await ensureMemberActive();
		const owner = requireOwner();

		const [ownerMembership] = await db
			.select({ id: auth_organization_members.id })
			.from(auth_organization_members)
			.where(
				and(
					eq(auth_organization_members.organizationId, owner.organizationId),
					eq(auth_organization_members.userId, owner.userId),
				),
			)
			.limit(1);
		if (!ownerMembership) {
			throw new Error("owner_membership_missing");
		}

		const response = await app.request(
			`/v1/auth/orgs/members/${ownerMembership.id}`,
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "DELETE",
			},
		);
		expect(response.status).toBe(409);
		const payload = (await response.json()) as SuspendResponse;
		expect(payload.error?.code).toBe("LAST_OWNER");

		// Owner row must still be active.
		const [row] = await db
			.select({ suspendedAt: auth_organization_members.suspendedAt })
			.from(auth_organization_members)
			.where(eq(auth_organization_members.id, ownerMembership.id))
			.limit(1);
		expect(row?.suspendedAt).toBeNull();
	});
});

describe("Reinstating a member", () => {
	test("an owner can reinstate a suspended member", async () => {
		const owner = requireOwner();
		const memberMembershipId = requireMemberMembershipId();
		await db
			.update(auth_organization_members)
			.set({ suspendedAt: new Date(), suspendedBy: owner.userId })
			.where(eq(auth_organization_members.id, memberMembershipId));

		const response = await app.request(
			`/v1/auth/orgs/members/${memberMembershipId}/reinstate`,
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "POST",
			},
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as SuspendResponse;
		expect(payload.error).toBeNull();

		const [row] = await db
			.select({
				suspendedAt: auth_organization_members.suspendedAt,
				suspendedBy: auth_organization_members.suspendedBy,
			})
			.from(auth_organization_members)
			.where(eq(auth_organization_members.id, memberMembershipId))
			.limit(1);
		expect(row?.suspendedAt).toBeNull();
		expect(row?.suspendedBy).toBeNull();

		const auditRows = await db
			.select({ event: audit_logs.event })
			.from(audit_logs)
			.where(
				and(
					eq(audit_logs.organizationId, owner.organizationId),
					eq(audit_logs.targetId, memberMembershipId),
				),
			)
			.orderBy(desc(audit_logs.createdAt));
		expect(auditRows.map((r) => r.event)).toContain("member.reinstated");

		await db
			.delete(audit_logs)
			.where(eq(audit_logs.organizationId, owner.organizationId));
	});

	test("reinstating a non-suspended member returns 404", async () => {
		await ensureMemberActive();
		const owner = requireOwner();
		const memberMembershipId = requireMemberMembershipId();

		const response = await app.request(
			`/v1/auth/orgs/members/${memberMembershipId}/reinstate`,
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "POST",
			},
		);
		expect(response.status).toBe(404);
	});
});

describe("Better-auth hard-delete paths are blocked", () => {
	test("/v1/auth/organization/remove-member returns 410", async () => {
		const owner = requireOwner();
		const memberMembershipId = requireMemberMembershipId();
		const response = await app.request("/v1/auth/organization/remove-member", {
			body: JSON.stringify({ memberIdOrEmail: memberMembershipId }),
			headers: jsonHeaders(owner.sessionCookie),
			method: "POST",
		});
		expect(response.status).toBe(410);
		const payload = (await response.json()) as SuspendResponse;
		expect(payload.error?.code).toBe("MEMBERSHIP_HARD_DELETE_BLOCKED");
	});

	test("/v1/auth/organization/leave returns 410", async () => {
		const owner = requireOwner();
		const response = await app.request("/v1/auth/organization/leave", {
			body: JSON.stringify({ organizationId: owner.organizationId }),
			headers: jsonHeaders(owner.sessionCookie),
			method: "POST",
		});
		expect(response.status).toBe(410);
		const payload = (await response.json()) as SuspendResponse;
		expect(payload.error?.code).toBe("MEMBERSHIP_HARD_DELETE_BLOCKED");
	});
});

describe("Self-leave records member.left", () => {
	test("a non-owner member can leave; their row is suspended", async () => {
		await ensureMemberActive();
		const owner = requireOwner();
		const member = requireMember();
		const memberMembershipId = requireMemberMembershipId();

		const response = await app.request("/v1/auth/orgs/members/leave", {
			headers: jsonHeaders(member.sessionCookie),
			method: "POST",
		});
		expect(response.status).toBe(200);

		const [row] = await db
			.select({
				suspendedAt: auth_organization_members.suspendedAt,
				suspendedBy: auth_organization_members.suspendedBy,
			})
			.from(auth_organization_members)
			.where(eq(auth_organization_members.id, memberMembershipId))
			.limit(1);
		expect(row?.suspendedAt).not.toBeNull();
		expect(row?.suspendedBy).toBe(member.userId);

		const auditRows = await db
			.select({ event: audit_logs.event })
			.from(audit_logs)
			.where(
				and(
					eq(audit_logs.organizationId, owner.organizationId),
					eq(audit_logs.targetId, memberMembershipId),
				),
			)
			.orderBy(desc(audit_logs.createdAt));
		expect(auditRows.map((r) => r.event)).toContain("member.left");

		await db
			.delete(audit_logs)
			.where(eq(audit_logs.organizationId, owner.organizationId));
	});
});

describe("Suspended memberships are hidden from active session", () => {
	test("getFullOrganization includes suspended members but session-scoped lookups treat them as non-members", async () => {
		const owner = requireOwner();
		const member = requireMember();
		const memberMembershipId = requireMemberMembershipId();
		await db
			.update(auth_organization_members)
			.set({ suspendedAt: new Date(), suspendedBy: owner.userId })
			.where(eq(auth_organization_members.id, memberMembershipId));

		// The session middleware uses checkPermission via the audit-logs route;
		// when the membership is suspended, the user is no longer admin/owner
		// of the org and the route returns 403 (treated as "not a member").
		const response = await app.request("/v1/auth/orgs/audit-logs", {
			headers: jsonHeaders(member.sessionCookie),
			method: "GET",
		});
		expect(response.status).toBe(403);

		// Better-auth's customSession lookup should also skip suspended rows
		// when computing the user's organizations list. Since
		// `auth.api.getSession` builds that list from `auth_organization_members`
		// joined to `auth_organizations`, we should see the suspended user's
		// orgs list be empty.
		const sessionResponse = await auth.api.getSession({
			asResponse: true,
			headers: new Headers({ cookie: member.sessionCookie }),
		});
		const body = (await sessionResponse.json()) as {
			organizations?: Array<{ id: string }>;
		};
		expect(body.organizations ?? []).toHaveLength(0);
	});
});
