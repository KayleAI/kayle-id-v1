import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { org_verification_records } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import internal from "@/internal";
import { setup, type TestData, teardown } from "../setup";

const FINALIZE_PATH = "/org-verification/finalize";

const VALID_BODY = {
	document_type: "passport" as const,
	document_number: "AB1234567",
	issuing_country: "GBR",
};

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

async function setOrgUnverified(organizationId: string): Promise<void> {
	await db
		.update(auth_organizations)
		.set({ verified_at: null })
		.where(eq(auth_organizations.id, organizationId));
}

async function clearRecordsForOrg(organizationId: string): Promise<void> {
	await db
		.delete(org_verification_records)
		.where(eq(org_verification_records.organizationId, organizationId));
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
			}),
		});
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("ORGANIZATION_NOT_FOUND");
	});

	test("flips verified_at + writes a dedup record on first finalize", async () => {
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
				organization_id: TEST_DATA.organizationId,
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
			.select({ verifiedAt: auth_organizations.verified_at })
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
});
