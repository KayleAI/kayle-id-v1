import { afterEach, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";
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

async function getOrganizationSlug(
	organizationId: string,
): Promise<string | undefined> {
	const [row] = await db
		.select({ slug: auth_organizations.slug })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId));

	return row?.slug;
}

afterEach(async () => {
	await teardownSessionAuth(testSession);
	testSession = undefined;
});

test("rejects direct Better Auth organization creation with an invalid slug", async () => {
	testSession = await setupSessionAuth();
	const slug = `Invalid/${crypto.randomUUID()}`;

	const response = await app.request("/v1/auth/organization/create", {
		body: JSON.stringify({
			name: "Invalid Slug Organization",
			slug,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);

	const [created] = await db
		.select({ id: auth_organizations.id })
		.from(auth_organizations)
		.where(eq(auth_organizations.slug, slug));

	expect(created).toBeUndefined();
});

test("rejects direct Better Auth organization updates with invalid slugs", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_slug_policy_session_missing_org");
	}
	const originalSlug = await getOrganizationSlug(testSession.organizationId);

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				slug: "Invalid Slug",
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getOrganizationSlug(testSession.organizationId)).toBe(
		originalSlug,
	);
});

test("allows direct Better Auth organization updates with valid slugs", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_slug_policy_session_missing_org");
	}
	const slug = `valid-${crypto.randomUUID()}`;

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				slug,
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(200);
	expect(await getOrganizationSlug(testSession.organizationId)).toBe(slug);
});
