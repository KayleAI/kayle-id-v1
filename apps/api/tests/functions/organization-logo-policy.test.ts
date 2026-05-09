import { afterEach, expect, test } from "bun:test";
import {
	createOrganizationLogoUrl,
	ORGANIZATION_LOGO_KEY_PREFIX,
} from "@kayle-id/auth/organization-logo";
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

function createUploadedLogoUrl(): string {
	return createOrganizationLogoUrl(
		`${ORGANIZATION_LOGO_KEY_PREFIX}${crypto.randomUUID()}`,
	);
}

async function getOrganizationLogo(
	organizationId: string,
): Promise<null | string> {
	const [row] = await db
		.select({ logo: auth_organizations.logo })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId));

	return row?.logo ?? null;
}

afterEach(async () => {
	await teardownSessionAuth(testSession);
	testSession = undefined;
});

test("rejects direct Better Auth organization logo updates that bypass the upload endpoint", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_logo_policy_session_missing_org");
	}

	const response = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: {
				logo: "data:image/svg+xml;base64,PHN2Zy8+",
			},
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getOrganizationLogo(testSession.organizationId)).toBeNull();
});

test("allows uploaded logo URLs and normalizes logo removal through Better Auth organization update", async () => {
	testSession = await setupSessionAuth({ withActiveOrganization: true });
	if (!testSession.organizationId) {
		throw new Error("organization_logo_policy_session_missing_org");
	}
	const logo = createUploadedLogoUrl();

	const setResponse = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: { logo },
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(setResponse.status).toBe(200);
	expect(await getOrganizationLogo(testSession.organizationId)).toBe(logo);

	const clearResponse = await app.request("/v1/auth/organization/update", {
		body: JSON.stringify({
			data: { logo: "" },
			organizationId: testSession.organizationId,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(clearResponse.status).toBe(200);
	expect(await getOrganizationLogo(testSession.organizationId)).toBeNull();
});

test("rejects direct Better Auth organization creation with a raw logo URL", async () => {
	testSession = await setupSessionAuth();
	const slug = `raw-logo-${crypto.randomUUID()}`;

	const response = await app.request("/v1/auth/organization/create", {
		body: JSON.stringify({
			logo: "https://example.com/logo.png",
			name: "Raw Logo Organization",
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
