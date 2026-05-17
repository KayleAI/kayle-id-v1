import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_rp_terms_acceptances,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";
import v1 from "@/v1";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;
const originalNodeEnv = process.env.NODE_ENV;
const originalPublicVerifyUrl = process.env.PUBLIC_VERIFY_URL;
const TEST_PUBLIC_VERIFY_URL = "http://localhost:2999";

function restoreNodeEnv(): void {
	if (originalNodeEnv === undefined) {
		Reflect.deleteProperty(process.env, "NODE_ENV");
		return;
	}
	process.env.NODE_ENV = originalNodeEnv;
}

function restorePublicVerifyUrl(): void {
	if (originalPublicVerifyUrl === undefined) {
		Reflect.deleteProperty(process.env, "PUBLIC_VERIFY_URL");
		return;
	}
	process.env.PUBLIC_VERIFY_URL = originalPublicVerifyUrl;
}

async function setOrganizationMetadata(
	metadata: Record<string, unknown> | null,
): Promise<void> {
	if (!TEST_DATA) {
		throw new Error("rp_compliance_test_data_missing");
	}

	await db
		.update(auth_organizations)
		.set({ metadata: metadata ? JSON.stringify(metadata) : null })
		.where(eq(auth_organizations.id, TEST_DATA.organizationId));
}

async function acceptCurrentRpTerms(): Promise<void> {
	if (!TEST_DATA) {
		throw new Error("rp_compliance_test_data_missing");
	}

	await db.insert(auth_organization_rp_terms_acceptances).values({
		organizationId: TEST_DATA.organizationId,
		termsVersion: RP_INTEGRATION_TERMS_VERSION,
		termsHash: RP_INTEGRATION_TERMS_HASH,
		jurisdiction: RP_INTEGRATION_TERMS_JURISDICTION,
		acceptedBy: TEST_DATA.userId,
	});
}

async function clearRpTermsAcceptance(): Promise<void> {
	if (!TEST_DATA) {
		return;
	}

	await db
		.delete(auth_organization_rp_terms_acceptances)
		.where(
			eq(
				auth_organization_rp_terms_acceptances.organizationId,
				TEST_DATA.organizationId,
			),
		);
}

async function createSession(): Promise<Response> {
	return await v1.request("/sessions", {
		headers: {
			Authorization: `Bearer ${TEST_DATA?.apiKey}`,
		},
		method: "POST",
	});
}

async function createProductionSession(): Promise<Response> {
	process.env.NODE_ENV = "production";
	process.env.PUBLIC_VERIFY_URL = TEST_PUBLIC_VERIFY_URL;
	try {
		return await createSession();
	} finally {
		restoreNodeEnv();
		restorePublicVerifyUrl();
	}
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(async () => {
	restoreNodeEnv();
	restorePublicVerifyUrl();
	await setOrganizationMetadata(null);
	await clearRpTermsAcceptance();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
	restoreNodeEnv();
	restorePublicVerifyUrl();
});

test.serial(
	"rejects production session creation when the RP compliance profile is incomplete",
	async () => {
		const response = await createProductionSession();

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string; hint: string };
		};
		expect(payload.error.code).toBe("RP_COMPLIANCE_PROFILE_INCOMPLETE");
		expect(payload.error.hint).toContain("legalControllerName");
		expect(payload.error.hint).toContain("usesKayleForConsequentialDecisions");
		expect(payload.error.hint).toContain("rpIntegrationTermsAcceptance");
	},
);

test.serial(
	"rejects production session creation until current RP integration terms are accepted",
	async () => {
		await setOrganizationMetadata({
			article6Basis: "legitimate interests",
			article9Condition: "explicit consent",
			controllerJurisdiction: "United Kingdom",
			legalControllerName: "Acme Ltd",
			privacyPolicyUrl: "https://acme.example/privacy",
			supportEmail: "support@acme.example",
			usesKayleForConsequentialDecisions: false,
		});

		const rejectedResponse = await createProductionSession();
		expect(rejectedResponse.status).toBe(400);
		const rejectedPayload = (await rejectedResponse.json()) as {
			error: { code: string; hint: string };
		};
		expect(rejectedPayload.error.code).toBe("RP_TERMS_ACCEPTANCE_REQUIRED");
		expect(rejectedPayload.error.hint).toContain(
			"current RP integration terms",
		);

		await acceptCurrentRpTerms();

		const acceptedResponse = await createProductionSession();
		expect(acceptedResponse.status).toBe(200);
	},
);

test.serial(
	"allows production session creation with an explicit non-consequential-use declaration",
	async () => {
		await setOrganizationMetadata({
			article6Basis: "legitimate interests",
			article9Condition: "explicit consent",
			controllerJurisdiction: "United Kingdom",
			legalControllerName: "Acme Ltd",
			privacyPolicyUrl: "https://acme.example/privacy",
			supportEmail: "support@acme.example",
			usesKayleForConsequentialDecisions: false,
		});
		await acceptCurrentRpTerms();

		const response = await createProductionSession();

		expect(response.status).toBe(200);
	},
);

test.serial(
	"requires fallback and review paths when Kayle results are used for consequential decisions",
	async () => {
		await setOrganizationMetadata({
			article6Basis: "legitimate interests",
			article9Condition: "explicit consent",
			controllerJurisdiction: "United Kingdom",
			legalControllerName: "Acme Ltd",
			privacyPolicyUrl: "https://acme.example/privacy",
			supportEmail: "support@acme.example",
			usesKayleForConsequentialDecisions: true,
		});

		const rejectedResponse = await createProductionSession();
		expect(rejectedResponse.status).toBe(400);
		const rejectedPayload = (await rejectedResponse.json()) as {
			error: { code: string; hint: string };
		};
		expect(rejectedPayload.error.code).toBe("RP_COMPLIANCE_PROFILE_INCOMPLETE");
		expect(rejectedPayload.error.hint).toContain("fallbackIdvUrl");
		expect(rejectedPayload.error.hint).toContain("appealUrl");

		await setOrganizationMetadata({
			article6Basis: "legitimate interests",
			article9Condition: "explicit consent",
			appealUrl: "https://acme.example/review",
			controllerJurisdiction: "United Kingdom",
			fallbackIdvUrl: "https://acme.example/manual-idv",
			legalControllerName: "Acme Ltd",
			privacyPolicyUrl: "https://acme.example/privacy",
			supportEmail: "support@acme.example",
			usesKayleForConsequentialDecisions: true,
		});
		await acceptCurrentRpTerms();

		const acceptedResponse = await createProductionSession();
		expect(acceptedResponse.status).toBe(200);
	},
);
