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

async function getOrganizationMetadata(
	organizationId: string,
): Promise<null | string> {
	const [row] = await db
		.select({ metadata: auth_organizations.metadata })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId));

	return row?.metadata ?? null;
}

afterEach(async () => {
	await teardownSessionAuth(testSession);
	testSession = undefined;
});

test("rejects direct Better Auth organization updates with non-string metadata fields", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_metadata_policy_session_missing_org");
	}

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				metadata: {
					description: { text: "bad" },
					website: "https://acme.example",
				},
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getOrganizationMetadata(testSession.organizationId)).toBeNull();
});

test("rejects direct Better Auth organization updates with unsafe website metadata", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_metadata_policy_session_missing_org");
	}

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				metadata: {
					description: "Acme",
					website: "javascript:alert(1)",
				},
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getOrganizationMetadata(testSession.organizationId)).toBeNull();
});

test("normalizes valid public metadata through direct Better Auth organization update", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_metadata_policy_session_missing_org");
	}

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				metadata: {
					description: "Acme identity checks",
					website: "https://acme.example/docs",
				},
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(200);
	expect(
		JSON.parse(
			(await getOrganizationMetadata(testSession.organizationId)) ?? "",
		),
	).toEqual({
		description: "Acme identity checks",
		website: "https://acme.example/docs",
	});
});
