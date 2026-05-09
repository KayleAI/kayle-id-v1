import { afterEach, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_invitations,
	auth_organization_members,
} from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "../session-auth";

let testSession: SessionAuthTestData | undefined;

function jsonHeaders(cookie: string): HeadersInit {
	return {
		"Content-Type": "application/json",
		Cookie: cookie,
	};
}

async function getMembership(): Promise<
	{ id: string; role: string } | undefined
> {
	if (!(testSession?.organizationId && testSession.userId)) {
		throw new Error("organization_role_policy_session_missing_org");
	}

	const [member] = await db
		.select({
			id: auth_organization_members.id,
			role: auth_organization_members.role,
		})
		.from(auth_organization_members)
		.where(
			and(
				eq(
					auth_organization_members.organizationId,
					testSession.organizationId,
				),
				eq(auth_organization_members.userId, testSession.userId),
			),
		)
		.limit(1);

	return member;
}

async function setCallerRole(role: string): Promise<void> {
	if (!(testSession?.organizationId && testSession.userId)) {
		throw new Error("organization_role_policy_session_missing_org");
	}

	await db
		.update(auth_organization_members)
		.set({ role })
		.where(
			and(
				eq(
					auth_organization_members.organizationId,
					testSession.organizationId,
				),
				eq(auth_organization_members.userId, testSession.userId),
			),
		);
}

afterEach(async () => {
	await teardownSessionAuth(testSession);
	testSession = undefined;
});

test("rejects direct Better Auth member role updates with comma-smuggled owner role", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_role_policy_session_missing_org");
	}
	const member = await getMembership();
	if (!member) {
		throw new Error("organization_role_policy_member_missing");
	}
	await setCallerRole("admin");

	const response = await app.request(
		"/v1/auth/organization/update-member-role",
		{
			body: JSON.stringify({
				memberId: member.id,
				organizationId: testSession.organizationId,
				role: "owner,",
			}),
			headers: jsonHeaders(testSession.sessionCookie),
			method: "POST",
		},
	);

	expect(response.status).toBe(400);
	expect((await getMembership())?.role).toBe("admin");
});

test("rejects direct Better Auth invitations with whitespace-smuggled owner role", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_role_policy_session_missing_org");
	}
	await setCallerRole("admin");
	const email = `${crypto.randomUUID()}@test.kayle.id`;

	const response = await app.request("/v1/auth/organization/invite-member", {
		body: JSON.stringify({
			email,
			organizationId: testSession.organizationId,
			role: "owner ",
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);

	const [invitation] = await db
		.select({ id: auth_invitations.id })
		.from(auth_invitations)
		.where(
			and(
				eq(auth_invitations.organizationId, testSession.organizationId),
				eq(auth_invitations.email, email),
			),
		)
		.limit(1);

	expect(invitation).toBeUndefined();
});
