import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import * as dohModule from "@kayle-id/auth/domain-verification/doh";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_domain_challenges,
	auth_organization_members,
	auth_organization_verified_domains,
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
	await db
		.delete(auth_organization_verified_domains)
		.where(
			eq(
				auth_organization_verified_domains.organizationId,
				TEST_DATA.organizationId,
			),
		);
	await db
		.delete(auth_organization_domain_challenges)
		.where(
			eq(
				auth_organization_domain_challenges.organizationId,
				TEST_DATA.organizationId,
			),
		);
	mock.restore();
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
	return {
		"Content-Type": "application/json",
		Cookie: cookie,
	};
}

describe("Organization domains API", () => {
	test("starts a DNS challenge for an owner", async () => {
		const session = require_session_data();
		const response = await app.request("/v1/auth/orgs/domains/challenges/dns", {
			body: JSON.stringify({ apex_domain: "kayle-test-acme.co" }),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				challenge_id: string;
				record_name: string;
				record_value: string;
				expires_at: string;
			};
		};
		expect(payload.data.record_name).toBe(
			"_kayle-id-verification.kayle-test-acme.co",
		);
		expect(
			payload.data.record_value.startsWith("kayle-id-verification="),
		).toBeTrue();
	});

	test("non-owner cannot start a challenge", async () => {
		const session = require_session_data();
		await db
			.update(auth_organization_members)
			.set({ role: "member" })
			.where(
				and(
					eq(auth_organization_members.organizationId, session.organizationId),
					eq(auth_organization_members.userId, session.userId),
				),
			);
		try {
			const response = await app.request(
				"/v1/auth/orgs/domains/challenges/dns",
				{
					body: JSON.stringify({ apex_domain: "kayle-test-acme.co" }),
					headers: jsonHeaders(session.sessionCookie),
					method: "POST",
				},
			);
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

	test("verifies a DNS challenge when the TXT record matches", async () => {
		const session = require_session_data();
		const startResponse = await app.request(
			"/v1/auth/orgs/domains/challenges/dns",
			{
				body: JSON.stringify({ apex_domain: "kayle-test-acme.co" }),
				headers: jsonHeaders(session.sessionCookie),
				method: "POST",
			},
		);
		const start = (await startResponse.json()) as {
			data: { challenge_id: string; record_value: string };
		};

		// Fake DoH so the verify endpoint sees the record.
		mock.module("@kayle-id/auth/domain-verification/doh", () => ({
			...dohModule,
			lookupTxt: async () => ({
				ok: true,
				values: [start.data.record_value],
			}),
		}));

		const verifyResponse = await app.request(
			"/v1/auth/orgs/domains/challenges/dns/verify",
			{
				body: JSON.stringify({ challenge_id: start.data.challenge_id }),
				headers: jsonHeaders(session.sessionCookie),
				method: "POST",
			},
		);
		expect(verifyResponse.status).toBe(200);

		const [row] = await db
			.select({
				apexDomain: auth_organization_verified_domains.apexDomain,
				downgradedAt: auth_organization_verified_domains.downgradedAt,
			})
			.from(auth_organization_verified_domains)
			.where(
				eq(
					auth_organization_verified_domains.organizationId,
					session.organizationId,
				),
			)
			.limit(1);
		expect(row?.apexDomain).toBe("kayle-test-acme.co");
		expect(row?.downgradedAt).toBeNull();
	});

	test("returns DNS_NOT_PROPAGATED when the TXT record is missing", async () => {
		const session = require_session_data();
		const startResponse = await app.request(
			"/v1/auth/orgs/domains/challenges/dns",
			{
				body: JSON.stringify({ apex_domain: "kayle-test-acme.co" }),
				headers: jsonHeaders(session.sessionCookie),
				method: "POST",
			},
		);
		const start = (await startResponse.json()) as {
			data: { challenge_id: string };
		};

		mock.module("@kayle-id/auth/domain-verification/doh", () => ({
			...dohModule,
			lookupTxt: async () => ({ ok: false, reason: "no_record" as const }),
		}));

		const verifyResponse = await app.request(
			"/v1/auth/orgs/domains/challenges/dns/verify",
			{
				body: JSON.stringify({ challenge_id: start.data.challenge_id }),
				headers: jsonHeaders(session.sessionCookie),
				method: "POST",
			},
		);
		expect(verifyResponse.status).toBe(409);
		const body = (await verifyResponse.json()) as {
			error: { code: string };
		};
		expect(body.error.code).toBe("DNS_NOT_PROPAGATED");
	});

	test("rejects bare public suffixes as the apex", async () => {
		const session = require_session_data();
		const response = await app.request("/v1/auth/orgs/domains/challenges/dns", {
			body: JSON.stringify({ apex_domain: "co.uk" }),
			headers: jsonHeaders(session.sessionCookie),
			method: "POST",
		});
		expect(response.status).toBe(400);
	});

	test("lists verified domains and active challenges for the org", async () => {
		const session = require_session_data();
		await db.insert(auth_organization_verified_domains).values({
			organizationId: session.organizationId,
			apexDomain: "kayle-test-acme.co",
			verifiedAt: new Date(),
			verifiedVia: "dns_txt",
			recheckToken: "abc",
		});

		const response = await app.request("/v1/auth/orgs/domains", {
			headers: jsonHeaders(session.sessionCookie),
			method: "GET",
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			data: {
				domains: { apexDomain: string }[];
				challenges: unknown[];
			};
		};
		expect(payload.data.domains.map((d) => d.apexDomain)).toContain(
			"kayle-test-acme.co",
		);
	});

	test("surfaces a conflict on start-challenge when another org owns the apex", async () => {
		const session = require_session_data();
		// Seed a different org as the active owner of the contested apex.
		const contestedApex = `contested${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}.invalid`;
		const [otherOrg] = await db
			.insert(auth_organizations)
			.values({
				id: crypto.randomUUID(),
				name: "Original Owner",
				slug: `original-${crypto.randomUUID()}`,
				createdAt: new Date(),
			})
			.returning({ id: auth_organizations.id });
		await db.insert(auth_organization_verified_domains).values({
			organizationId: otherOrg.id,
			apexDomain: contestedApex,
			verifiedAt: new Date(),
			verifiedVia: "dns_txt",
			recheckToken: "other-org-token",
		});

		try {
			const response = await app.request(
				"/v1/auth/orgs/domains/challenges/dns",
				{
					body: JSON.stringify({ apex_domain: contestedApex }),
					headers: jsonHeaders(session.sessionCookie),
					method: "POST",
				},
			);
			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				data: { conflict: { organization_name: string } | null };
			};
			expect(payload.data.conflict).toEqual({
				organization_name: "Original Owner",
			});
		} finally {
			await db
				.delete(auth_organizations)
				.where(eq(auth_organizations.id, otherOrg.id));
		}
	});

	test("verify rejects without acknowledge_takeover when conflict exists", async () => {
		const session = require_session_data();
		const contestedApex = `contested${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}.invalid`;
		const [otherOrg] = await db
			.insert(auth_organizations)
			.values({
				id: crypto.randomUUID(),
				name: "Original Owner",
				slug: `original-${crypto.randomUUID()}`,
				createdAt: new Date(),
			})
			.returning({ id: auth_organizations.id });
		await db.insert(auth_organization_verified_domains).values({
			organizationId: otherOrg.id,
			apexDomain: contestedApex,
			verifiedAt: new Date(),
			verifiedVia: "dns_txt",
			recheckToken: "other-org-token",
		});

		try {
			const startResponse = await app.request(
				"/v1/auth/orgs/domains/challenges/dns",
				{
					body: JSON.stringify({ apex_domain: contestedApex }),
					headers: jsonHeaders(session.sessionCookie),
					method: "POST",
				},
			);
			const start = (await startResponse.json()) as {
				data: { challenge_id: string; record_value: string };
			};

			mock.module("@kayle-id/auth/domain-verification/doh", () => ({
				...dohModule,
				lookupTxt: async () => ({
					ok: true,
					values: [start.data.record_value],
				}),
			}));

			const verifyResponse = await app.request(
				"/v1/auth/orgs/domains/challenges/dns/verify",
				{
					body: JSON.stringify({ challenge_id: start.data.challenge_id }),
					headers: jsonHeaders(session.sessionCookie),
					method: "POST",
				},
			);
			expect(verifyResponse.status).toBe(409);
			const payload = (await verifyResponse.json()) as {
				error: { code: string };
			};
			expect(payload.error.code).toBe("APEX_TAKEOVER_REQUIRED");
		} finally {
			await db
				.delete(auth_organizations)
				.where(eq(auth_organizations.id, otherOrg.id));
		}
	});

	test("verify with acknowledge_takeover transfers ownership and downgrades the previous row", async () => {
		const session = require_session_data();
		const contestedApex = `contested${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}.invalid`;
		const [otherOrg] = await db
			.insert(auth_organizations)
			.values({
				id: crypto.randomUUID(),
				name: "Original Owner",
				slug: `original-${crypto.randomUUID()}`,
				createdAt: new Date(),
			})
			.returning({ id: auth_organizations.id });
		await db.insert(auth_organization_verified_domains).values({
			organizationId: otherOrg.id,
			apexDomain: contestedApex,
			verifiedAt: new Date(),
			verifiedVia: "dns_txt",
			recheckToken: "other-org-token",
		});

		try {
			const startResponse = await app.request(
				"/v1/auth/orgs/domains/challenges/dns",
				{
					body: JSON.stringify({ apex_domain: contestedApex }),
					headers: jsonHeaders(session.sessionCookie),
					method: "POST",
				},
			);
			const start = (await startResponse.json()) as {
				data: { challenge_id: string; record_value: string };
			};

			mock.module("@kayle-id/auth/domain-verification/doh", () => ({
				...dohModule,
				lookupTxt: async () => ({
					ok: true,
					values: [start.data.record_value],
				}),
			}));

			const verifyResponse = await app.request(
				"/v1/auth/orgs/domains/challenges/dns/verify",
				{
					body: JSON.stringify({
						challenge_id: start.data.challenge_id,
						acknowledge_takeover: true,
					}),
					headers: jsonHeaders(session.sessionCookie),
					method: "POST",
				},
			);
			expect(verifyResponse.status).toBe(200);
			const payload = (await verifyResponse.json()) as {
				data: {
					takeover_from: {
						organization_id: string;
						organization_name: string;
					} | null;
				};
			};
			expect(payload.data.takeover_from).toEqual({
				organization_id: otherOrg.id,
				organization_name: "Original Owner",
			});

			const rows = await db
				.select({
					organizationId: auth_organization_verified_domains.organizationId,
					downgradedAt: auth_organization_verified_domains.downgradedAt,
				})
				.from(auth_organization_verified_domains)
				.where(
					eq(auth_organization_verified_domains.apexDomain, contestedApex),
				);

			const oldRow = rows.find((r) => r.organizationId === otherOrg.id);
			const newRow = rows.find(
				(r) => r.organizationId === session.organizationId,
			);
			expect(oldRow?.downgradedAt).not.toBeNull();
			expect(newRow?.downgradedAt).toBeNull();
		} finally {
			await db
				.delete(auth_organizations)
				.where(eq(auth_organizations.id, otherOrg.id));
		}
	});
});
