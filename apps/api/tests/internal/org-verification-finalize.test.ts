import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { org_verification_records } from "@kayle-id/database/schema/core";
import { eq, inArray } from "drizzle-orm";
import internal from "@/internal";
import { setup, type TestData, teardown } from "../setup";

const FINALIZE_PATH = "/org-verification/finalize";

const VALID_BODY = {
	document_type: "passport" as const,
	document_number: "AB1234567",
	issuing_country: "GBR",
};
const OVERSIZED_DOCUMENT_NUMBER = "A".repeat(129);

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	process.env.ORG_VERIFICATION_PEPPER ??= "test-org-verification-pepper";
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

async function setOrgUnverified(organizationId: string): Promise<void> {
	await db
		.update(auth_organizations)
		.set({ owner_id_checked_at: null, pending_deletion_at: null })
		.where(eq(auth_organizations.id, organizationId));
}

async function setOrgPendingDeletion(
	organizationId: string,
	pendingDeletionAt: Date | null,
): Promise<void> {
	await db
		.update(auth_organizations)
		.set({ pending_deletion_at: pendingDeletionAt })
		.where(eq(auth_organizations.id, organizationId));
}

async function clearRecordsForOrg(organizationId: string): Promise<void> {
	await db
		.delete(org_verification_records)
		.where(eq(org_verification_records.organizationId, organizationId));
}

async function createUnverifiedOrganization(
	ownerUserId: string,
	role = "owner",
): Promise<string> {
	const [org] = await db
		.insert(auth_organizations)
		.values({
			createdAt: new Date(),
			id: crypto.randomUUID(),
			name: "Org Verification Race Test",
			slug: `org-verification-${crypto.randomUUID()}`,
		})
		.returning({ id: auth_organizations.id });

	if (!org) {
		throw new Error("Failed to create organization.");
	}

	await db.insert(auth_organization_members).values({
		createdAt: new Date(),
		organizationId: org.id,
		role,
		userId: ownerUserId,
	});

	return org.id;
}

describe("POST /internal/org-verification/finalize", () => {
	test("rejects with 401 when Authorization header is missing", async () => {
		const response = await internal.request(FINALIZE_PATH, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...VALID_BODY,
				organization_id: crypto.randomUUID(),
			}),
		});
		expect(response.status).toBe(401);
	});

	test("rejects with 401 when bearer token does not match", async () => {
		const response = await internal.request(FINALIZE_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer wrong-token",
			},
			body: JSON.stringify({
				...VALID_BODY,
				organization_id: crypto.randomUUID(),
			}),
		});
		expect(response.status).toBe(401);
	});

	test("returns 404 when target organization does not exist", async () => {
		const response = await internal.request(FINALIZE_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
			},
			body: JSON.stringify({
				...VALID_BODY,
				organization_id: crypto.randomUUID(),
				owner_user_id: crypto.randomUUID(),
			}),
		});
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("ORGANIZATION_NOT_FOUND");
	});

	test("rejects oversized document numbers before recording verification", async () => {
		const response = await internal.request(FINALIZE_PATH, {
			body: JSON.stringify({
				...VALID_BODY,
				document_number: OVERSIZED_DOCUMENT_NUMBER,
				organization_id: crypto.randomUUID(),
				owner_user_id: crypto.randomUUID(),
			}),
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
			},
			method: "POST",
		});

		expect(response.status).toBe(400);
	});

	test("rejects non-alpha issuing country codes before finalizing", async () => {
		const response = await internal.request(FINALIZE_PATH, {
			body: JSON.stringify({
				...VALID_BODY,
				issuing_country: "G1R",
				organization_id: crypto.randomUUID(),
				owner_user_id: crypto.randomUUID(),
			}),
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
			},
			method: "POST",
		});

		expect(response.status).toBe(400);
	});

	test("rejects frozen organizations without writing a verification record", async () => {
		if (!TEST_DATA) {
			throw new Error("TEST_DATA missing");
		}
		await setOrgUnverified(TEST_DATA.organizationId);
		await clearRecordsForOrg(TEST_DATA.organizationId);
		await setOrgPendingDeletion(TEST_DATA.organizationId, new Date());

		try {
			const response = await internal.request(FINALIZE_PATH, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
				},
				body: JSON.stringify({
					...VALID_BODY,
					organization_id: TEST_DATA.organizationId,
					owner_user_id: TEST_DATA.userId,
				}),
			});

			expect(response.status).toBe(410);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("ORGANIZATION_FROZEN");

			const [org] = await db
				.select({ verifiedAt: auth_organizations.owner_id_checked_at })
				.from(auth_organizations)
				.where(eq(auth_organizations.id, TEST_DATA.organizationId))
				.limit(1);
			expect(org?.verifiedAt).toBeNull();

			const records = await db
				.select()
				.from(org_verification_records)
				.where(
					eq(org_verification_records.organizationId, TEST_DATA.organizationId),
				);
			expect(records.length).toBe(0);
		} finally {
			await setOrgPendingDeletion(TEST_DATA.organizationId, null);
		}
	});

	test("records owner ID check + writes a dedup record on first finalize", async () => {
		if (!TEST_DATA) {
			throw new Error("TEST_DATA missing");
		}
		await setOrgUnverified(TEST_DATA.organizationId);
		await clearRecordsForOrg(TEST_DATA.organizationId);

		const response = await internal.request(FINALIZE_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
			},
			body: JSON.stringify({
				...VALID_BODY,
				issuing_country: "gbr",
				organization_id: TEST_DATA.organizationId,
				owner_user_id: TEST_DATA.userId,
			}),
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: {
				verified_at: string;
				record_id: string | null;
				dedup_hash: string | null;
				pepper_version: number | null;
				already_verified: boolean;
			};
		};
		expect(body.data.already_verified).toBe(false);
		expect(body.data.record_id).toBeTruthy();
		expect(body.data.dedup_hash).toBeTruthy();
		expect(body.data.pepper_version).toBe(1);

		const [org] = await db
			.select({ verifiedAt: auth_organizations.owner_id_checked_at })
			.from(auth_organizations)
			.where(eq(auth_organizations.id, TEST_DATA.organizationId))
			.limit(1);
		expect(org?.verifiedAt).not.toBeNull();

		const records = await db
			.select()
			.from(org_verification_records)
			.where(
				eq(org_verification_records.organizationId, TEST_DATA.organizationId),
			);
		expect(records.length).toBe(1);
		expect(records[0]?.issuingCountry).toBe("GBR");
	});

	test("returns already_verified=true on retry without writing duplicate records", async () => {
		if (!TEST_DATA) {
			throw new Error("TEST_DATA missing");
		}

		const second = await internal.request(FINALIZE_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
			},
			body: JSON.stringify({
				...VALID_BODY,
				organization_id: TEST_DATA.organizationId,
				owner_user_id: TEST_DATA.userId,
			}),
		});

		expect(second.status).toBe(200);
		const body = (await second.json()) as {
			data: { already_verified: boolean; verified_at: string };
		};
		expect(body.data.already_verified).toBe(true);
		expect(body.data.verified_at).toBeTruthy();

		const records = await db
			.select()
			.from(org_verification_records)
			.where(
				eq(org_verification_records.organizationId, TEST_DATA.organizationId),
			);
		expect(records.length).toBe(1);
	});

	test("rejects finalization when the initiating user is no longer an owner", async () => {
		if (!TEST_DATA) {
			throw new Error("TEST_DATA missing");
		}
		const organizationId = await createUnverifiedOrganization(
			TEST_DATA.userId,
			"member",
		);

		try {
			const response = await internal.request(FINALIZE_PATH, {
				body: JSON.stringify({
					...VALID_BODY,
					document_number: `LOSTOWNER${crypto.randomUUID().replaceAll("-", "")}`,
					organization_id: organizationId,
					owner_user_id: TEST_DATA.userId,
				}),
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
				},
				method: "POST",
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("OWNER_NOT_ACTIVE");

			const [org] = await db
				.select({ verifiedAt: auth_organizations.owner_id_checked_at })
				.from(auth_organizations)
				.where(eq(auth_organizations.id, organizationId))
				.limit(1);
			expect(org?.verifiedAt).toBeNull();

			const records = await db
				.select()
				.from(org_verification_records)
				.where(eq(org_verification_records.organizationId, organizationId));
			expect(records.length).toBe(0);
		} finally {
			await db
				.delete(auth_organizations)
				.where(eq(auth_organizations.id, organizationId));
		}
	});

	test("allows only one organization to finalize the same document", async () => {
		if (!TEST_DATA) {
			throw new Error("TEST_DATA missing");
		}
		const firstOrgId = await createUnverifiedOrganization(TEST_DATA.userId);
		const secondOrgId = await createUnverifiedOrganization(TEST_DATA.userId);
		const documentNumber = `RACE${crypto.randomUUID().replaceAll("-", "")}`;
		const body = {
			...VALID_BODY,
			document_number: documentNumber,
		};

		try {
			const responses = await Promise.all([
				internal.request(FINALIZE_PATH, {
					body: JSON.stringify({
						...body,
						organization_id: firstOrgId,
						owner_user_id: TEST_DATA.userId,
					}),
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
					},
					method: "POST",
				}),
				internal.request(FINALIZE_PATH, {
					body: JSON.stringify({
						...body,
						organization_id: secondOrgId,
						owner_user_id: TEST_DATA.userId,
					}),
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${process.env.KAYLE_INTERNAL_TOKEN}`,
					},
					method: "POST",
				}),
			]);

			const statuses = responses.map((response) => response.status).sort();
			expect(statuses).toEqual([200, 409]);

			const rejected = responses.find((response) => response.status === 409);
			if (!rejected) {
				throw new Error("Expected one duplicate-document rejection.");
			}
			const rejectedBody = (await rejected.json()) as {
				error: { code: string };
			};
			expect(rejectedBody.error.code).toBe("DOCUMENT_ALREADY_USED");

			const orgRows = await db
				.select({
					id: auth_organizations.id,
					verifiedAt: auth_organizations.owner_id_checked_at,
				})
				.from(auth_organizations)
				.where(inArray(auth_organizations.id, [firstOrgId, secondOrgId]));
			expect(orgRows.filter((row) => row.verifiedAt !== null).length).toBe(1);

			const records = await db
				.select()
				.from(org_verification_records)
				.where(
					inArray(org_verification_records.organizationId, [
						firstOrgId,
						secondOrgId,
					]),
				);
			expect(records.length).toBe(1);
		} finally {
			await db
				.delete(auth_organizations)
				.where(inArray(auth_organizations.id, [firstOrgId, secondOrgId]));
		}
	});
});
