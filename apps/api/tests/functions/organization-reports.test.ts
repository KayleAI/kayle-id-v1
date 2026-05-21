import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_rp_terms_acceptances,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { organization_reports } from "@kayle-id/database/schema/organization-reports";
import { eq } from "drizzle-orm";
import app from "@/index";
import { generateId } from "@/utils/generate-id";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "../session-auth";
import {
	seedCompleteOrganizationOnboarding,
	setup,
	type TestData,
	teardown,
} from "../setup";

let REPORTED_ORG: TestData | undefined;
let ADMIN_SESSION: SessionAuthTestData | undefined;
const createdSessionIds: string[] = [];

function requireReportedOrg(): TestData {
	if (!REPORTED_ORG) {
		throw new Error("reported_org_missing");
	}
	return REPORTED_ORG;
}

function requireAdminSession(): SessionAuthTestData & {
	organizationId: string;
} {
	if (!ADMIN_SESSION?.organizationId) {
		throw new Error("admin_session_missing");
	}
	return ADMIN_SESSION as SessionAuthTestData & { organizationId: string };
}

async function createVerificationSession(
	organizationId: string,
): Promise<string> {
	const sessionId = generateId({ type: "vs" });
	await db.insert(verification_sessions).values({
		id: sessionId,
		organizationId,
	});
	createdSessionIds.push(sessionId);
	return sessionId;
}

async function submitReport(body: Record<string, unknown>): Promise<Response> {
	return app.request("/v1/verify/organization-reports", {
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
}

async function searchReportOrganizations(query: string): Promise<Response> {
	return app.request(
		`/v1/verify/report-organizations?query=${encodeURIComponent(query)}`,
		{ method: "GET" },
	);
}

async function searchPublicOrganizations({
	page,
	query,
}: {
	page?: number;
	query?: string;
} = {}): Promise<Response> {
	const searchParams = new URLSearchParams();
	if (query !== undefined) {
		searchParams.set("query", query);
	}
	if (page !== undefined) {
		searchParams.set("page", String(page));
	}

	const serialized = searchParams.toString();
	return app.request(
		`/v1/verify/organizations${serialized ? `?${serialized}` : ""}`,
		{ method: "GET" },
	);
}

async function getReportOrganization(identifier: string): Promise<Response> {
	return app.request(
		`/v1/verify/report-organizations/${encodeURIComponent(identifier)}`,
		{ method: "GET" },
	);
}

async function getPublicOrganization(identifier: string): Promise<Response> {
	return app.request(
		`/v1/verify/organizations/${encodeURIComponent(identifier)}`,
		{ method: "GET" },
	);
}

async function listReportsAsAdmin({
	query,
}: {
	query?: string;
} = {}): Promise<Response> {
	const admin = requireAdminSession();
	process.env.KAYLE_ORGANIZATION_ID = admin.organizationId;
	const searchParams = new URLSearchParams();
	if (query) {
		searchParams.set("query", query);
	}
	const serialized = searchParams.toString();

	return app.request(
		`/v1/admin/organization-reports${serialized ? `?${serialized}` : ""}`,
		{
			headers: { Cookie: admin.sessionCookie },
			method: "GET",
		},
	);
}

async function getReportAsAdmin(id: string): Promise<Response> {
	const admin = requireAdminSession();
	process.env.KAYLE_ORGANIZATION_ID = admin.organizationId;
	return app.request(`/v1/admin/organization-reports/${id}`, {
		headers: { Cookie: admin.sessionCookie },
		method: "GET",
	});
}

beforeAll(async () => {
	REPORTED_ORG = await setup();
	ADMIN_SESSION = await setupSessionAuth({ withActiveOrganization: true });
});

afterEach(async () => {
	const reportedOrg = REPORTED_ORG;
	if (reportedOrg) {
		await db
			.delete(organization_reports)
			.where(
				eq(
					organization_reports.reportedOrganizationId,
					reportedOrg.organizationId,
				),
			);
	}
	for (const sessionId of createdSessionIds) {
		await db
			.delete(verification_sessions)
			.where(eq(verification_sessions.id, sessionId));
	}
	createdSessionIds.length = 0;
	delete process.env.KAYLE_ORGANIZATION_ID;
});

afterAll(async () => {
	await teardownSessionAuth(ADMIN_SESSION);
	ADMIN_SESSION = undefined;
	await teardown(REPORTED_ORG);
	REPORTED_ORG = undefined;
});

describe("public organization report submission", () => {
	test("searches organizations that can be reported", async () => {
		const reportedOrg = requireReportedOrg();
		const response = await searchReportOrganizations(
			reportedOrg.verifiedApexDomains[0],
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				organizations: Array<{
					description: string | null;
					id: string;
					name: string;
					verified_apex_domains: string[];
					website: string | null;
				}>;
			};
			error: null;
		};

		expect(payload.data.organizations).toHaveLength(1);
		expect(payload.data.organizations[0]).toMatchObject({
			description: "Test organization fixture.",
			id: reportedOrg.organizationId,
			name: "Test Organization",
			website: "https://test.example",
		});
		expect(payload.data.organizations[0]?.verified_apex_domains).toEqual(
			[...reportedOrg.verifiedApexDomains].sort(),
		);
	});

	test("loads a reportable organization by slug", async () => {
		const reportedOrg = requireReportedOrg();
		const [organization] = await db
			.select({ slug: auth_organizations.slug })
			.from(auth_organizations)
			.where(eq(auth_organizations.id, reportedOrg.organizationId))
			.limit(1);

		if (!organization) {
			throw new Error("reported_org_slug_missing");
		}

		const response = await getReportOrganization(organization.slug);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				organization: {
					id: string;
					slug: string;
					verified_apex_domains: string[];
				};
			};
			error: null;
		};

		expect(payload.data.organization).toMatchObject({
			id: reportedOrg.organizationId,
			slug: organization.slug,
		});
		expect(payload.data.organization.verified_apex_domains).toEqual(
			[...reportedOrg.verifiedApexDomains].sort(),
		);
	});

	test("exposes the same terms-accepted organization through the public directory", async () => {
		const reportedOrg = requireReportedOrg();
		const searchResponse = await searchPublicOrganizations({
			query: reportedOrg.verifiedApexDomains[0],
		});
		expect(searchResponse.status).toBe(200);
		const searchPayload = (await searchResponse.json()) as {
			data: {
				organizations: Array<{
					id: string;
					integration_terms_accepted: boolean;
					owner_id_check_completed: boolean;
				}>;
			};
			error: null;
		};
		expect(searchPayload.data.organizations[0]).toMatchObject({
			id: reportedOrg.organizationId,
			integration_terms_accepted: true,
			owner_id_check_completed: true,
		});

		const detailResponse = await getPublicOrganization(
			reportedOrg.organizationId,
		);
		expect(detailResponse.status).toBe(200);
		const detailPayload = (await detailResponse.json()) as {
			data: {
				organization: {
					business_name: string | null;
					id: string;
					privacy_policy_url: string | null;
					rp_fallback: { support_email: string | null };
				};
			};
		};
		expect(detailPayload.data.organization).toMatchObject({
			business_name: "Test Organization Ltd",
			id: reportedOrg.organizationId,
			privacy_policy_url: "https://test.example/privacy",
			rp_fallback: { support_email: "support@test.example" },
		});
	});

	test("lists terms-accepted organizations for an empty query with pagination", async () => {
		const reportedOrg = requireReportedOrg();
		const response = await searchPublicOrganizations();

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				organizations: Array<{
					id: string;
					name: string;
				}>;
				pagination: {
					has_next_page: boolean;
					has_previous_page: boolean;
					page: number;
					page_size: number;
				};
			};
			error: null;
		};

		expect(
			payload.data.organizations.some(
				(organization) => organization.id === reportedOrg.organizationId,
			),
		).toBe(true);
		expect(payload.data.pagination).toMatchObject({
			has_previous_page: false,
			page: 1,
			page_size: 10,
		});

		const secondPageResponse = await searchPublicOrganizations({ page: 2 });
		expect(secondPageResponse.status).toBe(200);
		const secondPagePayload = (await secondPageResponse.json()) as {
			data: {
				pagination: {
					has_previous_page: boolean;
					page: number;
				};
			};
		};
		expect(secondPagePayload.data.pagination).toMatchObject({
			has_previous_page: true,
			page: 2,
		});
	});

	test("sorts public directory organizations by name in the database query", async () => {
		const createdOrgs: TestData[] = [];
		const directorySuffix = crypto.randomUUID().slice(0, 8);

		try {
			const zetaOrg = await setup();
			createdOrgs.push(zetaOrg);
			await db
				.update(auth_organizations)
				.set({
					name: `Zeta Directory ${directorySuffix}`,
					slug: `zeta-directory-${directorySuffix}`,
				})
				.where(eq(auth_organizations.id, zetaOrg.organizationId));

			const alphaOrg = await setup();
			createdOrgs.push(alphaOrg);
			await db
				.update(auth_organizations)
				.set({
					name: `Alpha Directory ${directorySuffix}`,
					slug: `alpha-directory-${directorySuffix}`,
				})
				.where(eq(auth_organizations.id, alphaOrg.organizationId));

			const response = await searchPublicOrganizations({
				query: `Directory ${directorySuffix}`,
			});
			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				data: {
					organizations: Array<{
						name: string;
					}>;
				};
			};

			expect(
				payload.data.organizations.map((organization) => organization.name),
			).toEqual([
				`Alpha Directory ${directorySuffix}`,
				`Zeta Directory ${directorySuffix}`,
			]);
		} finally {
			for (const organization of createdOrgs) {
				await teardown(organization);
			}
		}
	});

	test("hides organizations that have not accepted the current integration terms", async () => {
		const reportedOrg = requireReportedOrg();
		const [organization] = await db
			.select({ slug: auth_organizations.slug })
			.from(auth_organizations)
			.where(eq(auth_organizations.id, reportedOrg.organizationId))
			.limit(1);

		if (!organization) {
			throw new Error("reported_org_slug_missing");
		}

		await db
			.delete(auth_organization_rp_terms_acceptances)
			.where(
				eq(
					auth_organization_rp_terms_acceptances.organizationId,
					reportedOrg.organizationId,
				),
			);

		try {
			const searchResponse = await searchPublicOrganizations({
				query: reportedOrg.verifiedApexDomains[0],
			});
			expect(searchResponse.status).toBe(200);
			const searchPayload = (await searchResponse.json()) as {
				data: { organizations: unknown[] };
			};
			expect(searchPayload.data.organizations).toHaveLength(0);

			const directoryResponse = await searchPublicOrganizations();
			expect(directoryResponse.status).toBe(200);
			const directoryPayload = (await directoryResponse.json()) as {
				data: { organizations: Array<{ id: string }> };
			};
			expect(
				directoryPayload.data.organizations.some(
					(publicOrganization) =>
						publicOrganization.id === reportedOrg.organizationId,
				),
			).toBe(false);

			const detailResponse = await getPublicOrganization(
				reportedOrg.organizationId,
			);
			expect(detailResponse.status).toBe(404);

			const slugDetailResponse = await getPublicOrganization(organization.slug);
			expect(slugDetailResponse.status).toBe(404);
		} finally {
			await seedCompleteOrganizationOnboarding({
				organizationId: reportedOrg.organizationId,
				userId: reportedOrg.userId,
			});
		}
	});

	test("creates a report with organization ID only", async () => {
		const reportedOrg = requireReportedOrg();
		const response = await submitReport({
			details: "This organization is pretending to be someone else.",
			organization_id: reportedOrg.organizationId,
			reason: "impersonation",
		});

		expect(response.status).toBe(201);
		const payload = (await response.json()) as {
			data: { report_id: string };
			error: null;
		};
		expect(payload.data.report_id.startsWith("orpt_")).toBe(true);

		const [report] = await db
			.select()
			.from(organization_reports)
			.where(eq(organization_reports.id, payload.data.report_id))
			.limit(1);

		expect(report).toMatchObject({
			details: "This organization is pretending to be someone else.",
			reason: "impersonation",
			reportedOrganizationId: reportedOrg.organizationId,
			status: "open",
			verificationSessionId: null,
		});
	});

	test("creates a report with a matching verification session", async () => {
		const reportedOrg = requireReportedOrg();
		const sessionId = await createVerificationSession(
			reportedOrg.organizationId,
		);

		const response = await submitReport({
			organization_id: reportedOrg.organizationId,
			reason: "privacy_concern",
			session_id: sessionId,
		});

		expect(response.status).toBe(201);
		const payload = (await response.json()) as {
			data: { report_id: string };
		};
		const [report] = await db
			.select({
				verificationSessionId: organization_reports.verificationSessionId,
			})
			.from(organization_reports)
			.where(eq(organization_reports.id, payload.data.report_id))
			.limit(1);

		expect(report?.verificationSessionId).toBe(sessionId);
	});

	test("rejects a session that belongs to another organization", async () => {
		const reportedOrg = requireReportedOrg();
		const admin = requireAdminSession();
		const sessionId = await createVerificationSession(
			reportedOrg.organizationId,
		);

		const response = await submitReport({
			organization_id: admin.organizationId,
			reason: "deceptive_use",
			session_id: sessionId,
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string };
		};
		expect(payload.error.code).toBe("SESSION_ORGANIZATION_MISMATCH");
	});

	test("rejects invalid reason values", async () => {
		const reportedOrg = requireReportedOrg();
		const response = await submitReport({
			organization_id: reportedOrg.organizationId,
			reason: "not_a_reason",
		});

		expect(response.status).toBe(400);
	});
});

describe("admin organization report queue", () => {
	test("requires platform admin access", async () => {
		const response = await app.request("/v1/admin/organization-reports", {
			method: "GET",
		});
		expect(response.status).toBe(401);
	});

	test("lists and updates reports for platform admins", async () => {
		const reportedOrg = requireReportedOrg();
		const details = "No appeal route is shown for admin queue coverage.";
		const createResponse = await submitReport({
			details,
			organization_id: reportedOrg.organizationId,
			reason: "missing_fallback_or_appeal",
		});
		expect(createResponse.status).toBe(201);
		const createPayload = (await createResponse.json()) as {
			data: { report_id: string };
		};
		const reportId = createPayload.data.report_id;

		const listResponse = await listReportsAsAdmin({ query: details });
		expect(listResponse.status).toBe(200);
		const listPayload = (await listResponse.json()) as {
			data: {
				reports: Array<{
					admin_note: string | null;
					id: string;
					reason: string;
					reported_organization: {
						logo: string | null;
					};
					status: string;
				}>;
			};
		};
		const listedReport = listPayload.data.reports.find(
			(report) => report.id === reportId,
		);
		expect(listedReport?.reason).toBe("missing_fallback_or_appeal");
		expect(listedReport?.reported_organization.logo).toBe(
			"https://test.example/logo.png",
		);

		const admin = requireAdminSession();

		const searchResponse = await listReportsAsAdmin({
			query: "Test Organization",
		});
		expect(searchResponse.status).toBe(200);
		const searchPayload = (await searchResponse.json()) as {
			data: { reports: Array<{ id: string }> };
		};
		expect(searchPayload.data.reports.map((report) => report.id)).toContain(
			reportId,
		);

		const detailResponse = await getReportAsAdmin(reportId);
		expect(detailResponse.status).toBe(200);
		const detailPayload = (await detailResponse.json()) as {
			data: {
				report: { id: string; reported_organization: { logo: string | null } };
			};
		};
		expect(detailPayload.data.report.id).toBe(reportId);
		expect(detailPayload.data.report.reported_organization.logo).toBe(
			"https://test.example/logo.png",
		);

		const updateResponse = await app.request(
			`/v1/admin/organization-reports/${reportId}`,
			{
				body: JSON.stringify({
					admin_note: "Investigating with trust and safety.",
					status: "investigating",
				}),
				headers: {
					"Content-Type": "application/json",
					Cookie: admin.sessionCookie,
				},
				method: "PATCH",
			},
		);
		expect(updateResponse.status).toBe(200);
		const updatePayload = (await updateResponse.json()) as {
			data: { report: { admin_note: string | null; status: string } };
		};
		expect(updatePayload.data.report).toMatchObject({
			admin_note: "Investigating with trust and safety.",
			status: "investigating",
		});
	});
});
