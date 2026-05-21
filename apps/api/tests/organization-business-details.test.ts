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
} from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

let TEST_DATA: SessionAuthTestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setupSessionAuth({ withActiveOrganization: true });
});

afterAll(async () => {
	await teardownSessionAuth(TEST_DATA);
	TEST_DATA = undefined;
});

afterEach(async () => {
	if (!TEST_DATA?.organizationId) {
		return;
	}
	// Reset business details so each test starts from null state.
	await db
		.update(auth_organizations)
		.set({
			business_name: null,
			business_jurisdiction: null,
			business_registration_number: null,
		})
		.where(eq(auth_organizations.id, TEST_DATA.organizationId));
});

function require_session_data(): SessionAuthTestData & {
	organizationId: string;
} {
	if (!TEST_DATA?.organizationId) {
		throw new Error("session_auth_test_data_missing");
	}
	return TEST_DATA as SessionAuthTestData & { organizationId: string };
}

function jsonHeaders(cookie: string): HeadersInit {
	return { "Content-Type": "application/json", Cookie: cookie };
}

describe("Organization business details API", () => {
	test("owner can set all three fields and the row is updated", async () => {
		const session = require_session_data();
		const response = await app.request("/v1/auth/orgs/business-details", {
			body: JSON.stringify({
				business_name: "Acme Corporation Ltd",
				business_jurisdiction: "Earth (Planet)",
				business_registration_number: "12345678",
			}),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				businessName: string | null;
				businessJurisdiction: string | null;
				businessRegistrationNumber: string | null;
				businessType: "sole" | "business" | null;
			};
		};
		expect(payload.data).toEqual({
			businessName: "Acme Corporation Ltd",
			businessJurisdiction: "Earth (Planet)",
			businessRegistrationNumber: "12345678",
			businessType: null,
		});

		const [row] = await db
			.select({
				businessName: auth_organizations.business_name,
				businessJurisdiction: auth_organizations.business_jurisdiction,
				businessRegistrationNumber:
					auth_organizations.business_registration_number,
			})
			.from(auth_organizations)
			.where(eq(auth_organizations.id, session.organizationId))
			.limit(1);
		expect(row).toEqual({
			businessName: "Acme Corporation Ltd",
			businessJurisdiction: "Earth (Planet)",
			businessRegistrationNumber: "12345678",
		});
	});

	test("trims whitespace and treats empty strings as cleared values", async () => {
		const session = require_session_data();
		await db
			.update(auth_organizations)
			.set({
				business_name: "Pre-existing",
				business_jurisdiction: "Earth (Planet)",
				business_registration_number: "12345678",
			})
			.where(eq(auth_organizations.id, session.organizationId));

		const response = await app.request("/v1/auth/orgs/business-details", {
			body: JSON.stringify({
				business_name: "  Acme Inc.  ",
				business_jurisdiction: "",
				business_registration_number: null,
			}),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				businessName: string | null;
				businessJurisdiction: string | null;
				businessRegistrationNumber: string | null;
				businessType: "sole" | "business" | null;
			};
		};
		expect(payload.data).toEqual({
			businessName: "Acme Inc.",
			businessJurisdiction: null,
			businessRegistrationNumber: null,
			businessType: null,
		});
	});

	test("omitting a field leaves the column unchanged", async () => {
		const session = require_session_data();
		await db
			.update(auth_organizations)
			.set({
				business_name: "Existing Legal Name",
				business_jurisdiction: "Existing Jurisdiction",
				business_registration_number: "999",
			})
			.where(eq(auth_organizations.id, session.organizationId));

		const response = await app.request("/v1/auth/orgs/business-details", {
			body: JSON.stringify({
				business_name: "Updated Legal Name",
			}),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				businessName: string | null;
				businessJurisdiction: string | null;
				businessRegistrationNumber: string | null;
				businessType: "sole" | "business" | null;
			};
		};
		expect(payload.data).toEqual({
			businessName: "Updated Legal Name",
			businessJurisdiction: "Existing Jurisdiction",
			businessRegistrationNumber: "999",
			businessType: null,
		});
	});

	test("accepts business_type and persists it; rejects unknown values", async () => {
		const session = require_session_data();

		const okResponse = await app.request("/v1/auth/orgs/business-details", {
			body: JSON.stringify({
				business_type: "sole",
				business_name: "Jane Doe",
			}),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});
		expect(okResponse.status).toBe(200);
		const okPayload = (await okResponse.json()) as {
			data: { businessType: "sole" | "business" | null };
		};
		expect(okPayload.data.businessType).toBe("sole");

		// Regression: better-auth's `getFullOrganization` reads via the
		// Drizzle adapter which keys columns by the schema's TS field
		// names. The `business_type` column must therefore use a
		// snake_case TS field name to match the configured `fieldName`,
		// or `businessType` comes back undefined and the platform UI
		// falls back to the default "Business" type.
		const fullOrg = (await auth.api.getFullOrganization({
			headers: new Headers({ cookie: session.sessionCookie }),
			query: { organizationId: session.organizationId },
		})) as { businessType?: "sole" | "business" | null } | null;
		expect(fullOrg?.businessType).toBe("sole");

		const clearResponse = await app.request("/v1/auth/orgs/business-details", {
			body: JSON.stringify({ business_type: null }),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});
		expect(clearResponse.status).toBe(200);
		const clearPayload = (await clearResponse.json()) as {
			data: { businessType: "sole" | "business" | null };
		};
		expect(clearPayload.data.businessType).toBeNull();

		const badResponse = await app.request("/v1/auth/orgs/business-details", {
			body: JSON.stringify({ business_type: "partnership" }),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});
		expect(badResponse.status).toBe(400);
	});

	test("rejects values containing control characters", async () => {
		const session = require_session_data();
		const response = await app.request("/v1/auth/orgs/business-details", {
			body: JSON.stringify({
				business_name: "AcmeCorp",
			}),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string };
		};
		expect(payload.error.code).toBe("INVALID_BUSINESS_DETAILS");
	});

	test("non-owner is forbidden", async () => {
		const session = require_session_data();
		await db
			.update(auth_organization_members)
			.set({ role: "admin" })
			.where(
				and(
					eq(auth_organization_members.organizationId, session.organizationId),
					eq(auth_organization_members.userId, session.userId),
				),
			);
		try {
			const response = await app.request("/v1/auth/orgs/business-details", {
				body: JSON.stringify({ business_name: "Sneaky Inc." }),
				headers: jsonHeaders(session.sessionCookie),
				method: "POST",
			});
			expect(response.status).toBe(403);
		} finally {
			await db
				.update(auth_organization_members)
				.set({ role: "owner" })
				.where(
					and(
						eq(
							auth_organization_members.organizationId,
							session.organizationId,
						),
						eq(auth_organization_members.userId, session.userId),
					),
				);
		}
	});
});
