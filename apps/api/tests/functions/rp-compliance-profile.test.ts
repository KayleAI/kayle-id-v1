import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";
import v1 from "@/v1";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;
const originalNodeEnv = process.env.NODE_ENV;

function restoreNodeEnv(): void {
	if (originalNodeEnv === undefined) {
		Reflect.deleteProperty(process.env, "NODE_ENV");
		return;
	}
	process.env.NODE_ENV = originalNodeEnv;
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

afterEach(async () => {
	restoreNodeEnv();
	await setOrganizationMetadata(null);
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
	restoreNodeEnv();
});

test.serial(
	"rejects production session creation when the RP compliance profile is incomplete",
	async () => {
		process.env.NODE_ENV = "production";

		const response = await createSession();

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: { code: string; hint: string };
		};
		expect(payload.error.code).toBe("RP_COMPLIANCE_PROFILE_INCOMPLETE");
		expect(payload.error.hint).toContain("legalControllerName");
		expect(payload.error.hint).toContain("usesKayleForConsequentialDecisions");
	},
);

test.serial(
	"allows production session creation with an explicit non-consequential-use declaration",
	async () => {
		process.env.NODE_ENV = "production";
		await setOrganizationMetadata({
			article6Basis: "legitimate interests",
			article9Condition: "explicit consent",
			controllerJurisdiction: "United Kingdom",
			legalControllerName: "Acme Ltd",
			privacyPolicyUrl: "https://acme.example/privacy",
			supportEmail: "support@acme.example",
			usesKayleForConsequentialDecisions: false,
		});

		const response = await createSession();

		expect(response.status).toBe(200);
	},
);

test.serial(
	"requires fallback and review paths when Kayle results are used for consequential decisions",
	async () => {
		process.env.NODE_ENV = "production";
		await setOrganizationMetadata({
			article6Basis: "legitimate interests",
			article9Condition: "explicit consent",
			controllerJurisdiction: "United Kingdom",
			legalControllerName: "Acme Ltd",
			privacyPolicyUrl: "https://acme.example/privacy",
			supportEmail: "support@acme.example",
			usesKayleForConsequentialDecisions: true,
		});

		const rejectedResponse = await createSession();
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

		const acceptedResponse = await createSession();
		expect(acceptedResponse.status).toBe(200);
	},
);
