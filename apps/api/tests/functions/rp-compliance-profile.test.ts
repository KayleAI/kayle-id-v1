import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	test,
} from "bun:test";
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

const COMPLETE_METADATA = {
	article6Basis: "legitimate interests",
	article9Condition: "explicit consent",
	controllerJurisdiction: "United Kingdom",
	description: "Acme test org.",
	legalControllerName: "Acme Ltd",
	privacyPolicyUrl: "https://acme.example/privacy",
	supportEmail: "support@acme.example",
	termsOfServiceUrl: "https://acme.example/terms",
	usesKayleForConsequentialDecisions: false,
	website: "https://acme.example",
} as const;

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

async function setBusinessAndLogo({
	complete,
}: {
	complete: boolean;
}): Promise<void> {
	if (!TEST_DATA) {
		throw new Error("rp_compliance_test_data_missing");
	}

	await db
		.update(auth_organizations)
		.set(
			complete
				? {
						business_type: "business",
						business_name: "Acme Ltd",
						business_jurisdiction: "United Kingdom",
						business_registration_number: "12345678",
						logo: "https://acme.example/logo.png",
					}
				: {
						business_type: null,
						business_name: null,
						business_jurisdiction: null,
						business_registration_number: null,
						logo: null,
					},
		)
		.where(eq(auth_organizations.id, TEST_DATA.organizationId));
}

async function setOwnerIdChecked(checked: boolean): Promise<void> {
	if (!TEST_DATA) {
		throw new Error("rp_compliance_test_data_missing");
	}

	await db
		.update(auth_organizations)
		.set({ owner_id_checked_at: checked ? new Date() : null })
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

async function resetOrganizationOnboarding(): Promise<void> {
	await setOrganizationMetadata(null);
	await setBusinessAndLogo({ complete: false });
	await setOwnerIdChecked(false);
	await clearRpTermsAcceptance();
}

async function createSession(): Promise<Response> {
	return await v1.request("/sessions", {
		headers: {
			Authorization: `Bearer ${TEST_DATA?.apiKey}`,
		},
		method: "POST",
	});
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

beforeEach(async () => {
	// The shared setup() seeds a fully-onboarded org so unrelated session tests
	// still pass under always-on gate enforcement. This file exercises the gate
	// itself, so wipe every onboarding facet before each case and let the test
	// repopulate the state it needs.
	await resetOrganizationOnboarding();
});

afterEach(async () => {
	await resetOrganizationOnboarding();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

test.serial(
	"rejects session creation when the entire onboarding flow is incomplete",
	async () => {
		const response = await createSession();

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string; hint: string };
		};
		expect(payload.error.code).toBe("ONBOARDING_INCOMPLETE");
		expect(payload.error.hint).toContain("business");
		expect(payload.error.hint).toContain("public");
		expect(payload.error.hint).toContain("compliance");
		expect(payload.error.hint).toContain("owner_id");
	},
);

test.serial(
	"rejects session creation until current Kayle ID Integration Terms are accepted",
	async () => {
		await setBusinessAndLogo({ complete: true });
		await setOwnerIdChecked(true);
		await setOrganizationMetadata(COMPLETE_METADATA);

		const rejectedResponse = await createSession();
		expect(rejectedResponse.status).toBe(400);
		const rejectedPayload = (await rejectedResponse.json()) as {
			error: { code: string; hint: string };
		};
		expect(rejectedPayload.error.code).toBe("RP_TERMS_ACCEPTANCE_REQUIRED");
		expect(rejectedPayload.error.hint).toContain(
			"current Kayle ID Integration Terms",
		);

		await acceptCurrentRpTerms();

		const acceptedResponse = await createSession();
		expect(acceptedResponse.status).toBe(200);
	},
);

test.serial(
	"allows session creation when all four onboarding steps are complete",
	async () => {
		await setBusinessAndLogo({ complete: true });
		await setOwnerIdChecked(true);
		await setOrganizationMetadata(COMPLETE_METADATA);
		await acceptCurrentRpTerms();

		const response = await createSession();

		expect(response.status).toBe(200);
	},
);

test.serial(
	"flags missing business step when only business details are absent",
	async () => {
		await setOwnerIdChecked(true);
		await setOrganizationMetadata(COMPLETE_METADATA);
		await acceptCurrentRpTerms();

		const response = await createSession();
		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string; hint: string };
		};
		expect(payload.error.code).toBe("ONBOARDING_INCOMPLETE");
		expect(payload.error.hint).toContain("business");
		expect(payload.error.hint).toContain("businessType");
	},
);

test.serial(
	"flags missing public step when logo and public metadata are absent",
	async () => {
		await setOwnerIdChecked(true);
		await setOrganizationMetadata({
			...COMPLETE_METADATA,
			description: undefined,
			termsOfServiceUrl: undefined,
			website: undefined,
		});
		await acceptCurrentRpTerms();
		// Business details still incomplete from the reset; populate them so the
		// gate's only complaint is the public step.
		await setBusinessAndLogo({ complete: true });
		// Then clear just the logo + public metadata fields, leaving business
		// columns intact.
		await db
			.update(auth_organizations)
			.set({ logo: null })
			.where(eq(auth_organizations.id, TEST_DATA?.organizationId ?? ""));
		await setOrganizationMetadata({
			article6Basis: COMPLETE_METADATA.article6Basis,
			article9Condition: COMPLETE_METADATA.article9Condition,
			controllerJurisdiction: COMPLETE_METADATA.controllerJurisdiction,
			legalControllerName: COMPLETE_METADATA.legalControllerName,
			privacyPolicyUrl: COMPLETE_METADATA.privacyPolicyUrl,
			supportEmail: COMPLETE_METADATA.supportEmail,
			usesKayleForConsequentialDecisions: false,
		});

		const response = await createSession();
		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string; hint: string };
		};
		expect(payload.error.code).toBe("ONBOARDING_INCOMPLETE");
		expect(payload.error.hint).toContain("public");
		expect(payload.error.hint).toContain("logo");
		expect(payload.error.hint).toContain("website");
	},
);

test.serial(
	"flags missing owner_id step when the owner has not completed an identity check",
	async () => {
		await setBusinessAndLogo({ complete: true });
		await setOrganizationMetadata(COMPLETE_METADATA);
		await acceptCurrentRpTerms();
		// Owner ID check intentionally left off.

		const response = await createSession();
		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string; hint: string };
		};
		expect(payload.error.code).toBe("ONBOARDING_INCOMPLETE");
		expect(payload.error.hint).toContain("owner_id");
	},
);

test.serial(
	"requires fallback and review paths when Kayle results are used for consequential decisions",
	async () => {
		await setBusinessAndLogo({ complete: true });
		await setOwnerIdChecked(true);
		await setOrganizationMetadata({
			...COMPLETE_METADATA,
			usesKayleForConsequentialDecisions: true,
		});
		await acceptCurrentRpTerms();

		const rejectedResponse = await createSession();
		expect(rejectedResponse.status).toBe(400);
		const rejectedPayload = (await rejectedResponse.json()) as {
			error: { code: string; hint: string };
		};
		expect(rejectedPayload.error.code).toBe("ONBOARDING_INCOMPLETE");
		expect(rejectedPayload.error.hint).toContain("fallbackIdvUrl");
		expect(rejectedPayload.error.hint).toContain("appealUrl");

		await setOrganizationMetadata({
			...COMPLETE_METADATA,
			appealUrl: "https://acme.example/review",
			fallbackIdvUrl: "https://acme.example/manual-idv",
			usesKayleForConsequentialDecisions: true,
		});

		const acceptedResponse = await createSession();
		expect(acceptedResponse.status).toBe(200);
	},
);
