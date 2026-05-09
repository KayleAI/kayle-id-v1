import { afterEach, expect, test } from "bun:test";
import {
	normalizeOrganizationName,
	ORGANIZATION_NAME_MAX_LENGTH,
} from "@kayle-id/auth/organization-name";
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

async function getOrganizationName(
	organizationId: string,
): Promise<string | undefined> {
	const [row] = await db
		.select({ name: auth_organizations.name })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId));

	return row?.name;
}

afterEach(async () => {
	await teardownSessionAuth(testSession);
	testSession = undefined;
});

test("rejects direct Better Auth organization creation with an oversized name", async () => {
	testSession = await setupSessionAuth();
	const name = "a".repeat(ORGANIZATION_NAME_MAX_LENGTH + 1);
	const slug = `oversized-name-${crypto.randomUUID()}`;

	const response = await app.request("/v1/auth/organization/create", {
		body: JSON.stringify({
			name,
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

test("rejects direct Better Auth organization updates with control characters", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_name_policy_session_missing_org");
	}
	const originalName = await getOrganizationName(testSession.organizationId);

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				name: "Acme\nInc",
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getOrganizationName(testSession.organizationId)).toBe(
		originalName,
	);
});

test("normalizes direct Better Auth organization updates with valid names", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_name_policy_session_missing_org");
	}
	const expectedName = normalizeOrganizationName("Renamed Organization");

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				name: "  Renamed Organization  ",
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(200);
	expect(await getOrganizationName(testSession.organizationId)).toBe(
		expectedName,
	);
});
