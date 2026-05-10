import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_organization_verified_domains } from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";
import { validateRedirectUrlForOrg } from "@/v1/sessions/redirect-uri-validator";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

function organizationId(): string {
	if (!TEST_DATA) {
		throw new Error("test_data_missing");
	}
	return TEST_DATA.organizationId;
}

function primaryApex(): string {
	if (!TEST_DATA) {
		throw new Error("test_data_missing");
	}
	return TEST_DATA.verifiedApexDomains[0];
}

describe("validateRedirectUrlForOrg", () => {
	test("null and empty are accepted as no-redirect", async () => {
		await expect(
			validateRedirectUrlForOrg({
				organizationId: organizationId(),
				raw: null,
			}),
		).resolves.toEqual({ ok: true, normalized: null });
		await expect(
			validateRedirectUrlForOrg({
				organizationId: organizationId(),
				raw: "",
			}),
		).resolves.toEqual({ ok: true, normalized: null });
	});

	test("accepts apex on a verified domain", async () => {
		const apex = primaryApex();
		const outcome = await validateRedirectUrlForOrg({
			organizationId: organizationId(),
			raw: `https://${apex}/cb`,
		});
		expect(outcome.ok).toBeTrue();
		if (outcome.ok) {
			expect(outcome.normalized).toBe(`https://${apex}/cb`);
		}
	});

	test("accepts deep subdomain on a verified apex", async () => {
		const apex = primaryApex();
		const outcome = await validateRedirectUrlForOrg({
			organizationId: organizationId(),
			raw: `https://app.id.${apex}/oauth/return?state=x`,
		});
		expect(outcome.ok).toBeTrue();
	});

	test("rejects URLs whose host is not on a verified apex", async () => {
		const outcome = await validateRedirectUrlForOrg({
			organizationId: organizationId(),
			raw: "https://attacker.invalid/cb",
		});
		expect(outcome.ok).toBeFalse();
		if (!outcome.ok) {
			expect(outcome.code).toBe("REDIRECT_URL_DOMAIN_NOT_VERIFIED");
		}
	});

	test("rejects look-alike hosts (apex vs evil-apex)", async () => {
		const apex = primaryApex();
		const outcome = await validateRedirectUrlForOrg({
			organizationId: organizationId(),
			raw: `https://evil-${apex}/cb`,
		});
		expect(outcome.ok).toBeFalse();
		if (!outcome.ok) {
			expect(outcome.code).toBe("REDIRECT_URL_DOMAIN_NOT_VERIFIED");
		}
	});

	test("rejects http:// (non-loopback) URLs", async () => {
		const apex = primaryApex();
		const outcome = await validateRedirectUrlForOrg({
			organizationId: organizationId(),
			raw: `http://${apex}/cb`,
		});
		expect(outcome.ok).toBeFalse();
		if (!outcome.ok) {
			expect(outcome.code).toBe("INVALID_REDIRECT_URL");
		}
	});

	test("rejects URLs with embedded credentials", async () => {
		const apex = primaryApex();
		const outcome = await validateRedirectUrlForOrg({
			organizationId: organizationId(),
			raw: `https://user:pw@${apex}/cb`,
		});
		expect(outcome.ok).toBeFalse();
		if (!outcome.ok) {
			expect(outcome.code).toBe("INVALID_REDIRECT_URL");
		}
	});

	test("rejects malformed URLs", async () => {
		const outcome = await validateRedirectUrlForOrg({
			organizationId: organizationId(),
			raw: "not a url",
		});
		expect(outcome.ok).toBeFalse();
		if (!outcome.ok) {
			expect(outcome.code).toBe("INVALID_REDIRECT_URL");
		}
	});

	test("a downgraded verified-domain row no longer authorizes its apex", async () => {
		const orgId = organizationId();
		const apex = primaryApex();
		await db
			.update(auth_organization_verified_domains)
			.set({ downgradedAt: new Date() })
			.where(
				and(
					eq(auth_organization_verified_domains.organizationId, orgId),
					eq(auth_organization_verified_domains.apexDomain, apex),
				),
			);

		try {
			const outcome = await validateRedirectUrlForOrg({
				organizationId: orgId,
				raw: `https://${apex}/cb`,
			});
			expect(outcome.ok).toBeFalse();
			if (!outcome.ok) {
				expect(outcome.code).toBe("REDIRECT_URL_DOMAIN_NOT_VERIFIED");
			}
		} finally {
			await db
				.update(auth_organization_verified_domains)
				.set({ downgradedAt: null })
				.where(
					and(
						eq(auth_organization_verified_domains.organizationId, orgId),
						eq(auth_organization_verified_domains.apexDomain, apex),
					),
				);
		}
	});
});
