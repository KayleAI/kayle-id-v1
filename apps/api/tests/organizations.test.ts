import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { auth } from "@kayle-id/auth/server";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq, inArray } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

type OrganizationCreateResponse = {
	data: null | {
		id: string;
	};
	error: null | {
		code: string;
		docs?: string;
		hint?: string;
		message: string;
	};
};

let TEST_DATA: SessionAuthTestData | undefined;
const createdOrganizationIds: string[] = [];
const originalCreateOrganization = auth.api.createOrganization;
const originalStorage = env.STORAGE;

type CreateOrganizationMockInput = {
	body: {
		logo?: string;
		name: string;
		slug: string;
		userId: string;
	};
};
type CreateOrganizationMockResult = { id: string };

function createOrganizationMock(
	implementation: (
		input: CreateOrganizationMockInput,
	) => CreateOrganizationMockResult | Promise<CreateOrganizationMockResult>,
): typeof auth.api.createOrganization {
	const endpoint: unknown = Object.assign(mock(implementation), {
		options: originalCreateOrganization.options,
		path: originalCreateOrganization.path,
	});

	return endpoint as typeof auth.api.createOrganization;
}
type StorageBinding = NonNullable<typeof env.STORAGE>;
const LOCAL_LOGO_URL_PATTERN = /^http:\/\/127\.0\.0\.1:8787\/r2\/logos\//u;
const LOGO_SLUG_PATTERN = /^logo-/u;

const PNG_SIGNATURE_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const OVERSIZED_LOGO_DIMENSION = 4096;

function base64Encode(bytes: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}
	return btoa(binary);
}

function createPngHeaderBytes(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array([
		...PNG_SIGNATURE_BYTES,
		0x00,
		0x00,
		0x00,
		0x0d,
		0x49,
		0x48,
		0x44,
		0x52,
		(width >>> 24) & 0xff,
		(width >>> 16) & 0xff,
		(width >>> 8) & 0xff,
		width & 0xff,
		(height >>> 24) & 0xff,
		(height >>> 16) & 0xff,
		(height >>> 8) & 0xff,
		height & 0xff,
		0x08,
		0x06,
		0x00,
		0x00,
		0x00,
	]);

	return bytes;
}

const TINY_PNG_BASE64 = base64Encode(createPngHeaderBytes(1, 1));
const TRUNCATED_PNG_BASE64 = base64Encode(PNG_SIGNATURE_BYTES);
const OVERSIZED_PNG_BASE64 = base64Encode(
	createPngHeaderBytes(OVERSIZED_LOGO_DIMENSION, 1),
);

function requireTestData(): SessionAuthTestData {
	if (!TEST_DATA) {
		throw new Error("organizations_test_data_missing");
	}

	return TEST_DATA;
}

function createJsonHeaders(cookie?: string): HeadersInit {
	return {
		"Content-Type": "application/json",
		...(cookie ? { Cookie: cookie } : {}),
	};
}

beforeAll(async () => {
	TEST_DATA = await setupSessionAuth();
});

afterEach(async () => {
	auth.api.createOrganization = originalCreateOrganization;
	(
		env as typeof env & {
			STORAGE: typeof env.STORAGE;
		}
	).STORAGE = originalStorage;
	mock.restore();

	if (createdOrganizationIds.length === 0) {
		return;
	}

	await db
		.delete(auth_organizations)
		.where(inArray(auth_organizations.id, [...createdOrganizationIds]));
	createdOrganizationIds.length = 0;
});

afterAll(async () => {
	await teardownSessionAuth(TEST_DATA);
	TEST_DATA = undefined;
});

describe("Organization Endpoints", () => {
	test("returns unauthorized without a session cookie", async () => {
		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				name: "Unauthorized Organization",
				slug: `unauthorized-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(),
			method: "POST",
		});

		expect(response.status).toBe(401);

		const payload = (await response.json()) as {
			error: {
				code: string;
				message: string;
			};
		};

		expect(payload.error).toEqual({
			code: "UNAUTHORIZED",
			message: "Unauthorized",
		});
	});

	test("creates an organization for an authenticated session", async () => {
		const testData = requireTestData();
		const slug = `org-${crypto.randomUUID()}`;
		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				name: "Created Organization",
				slug,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(200);

		const payload = (await response.json()) as OrganizationCreateResponse;
		const organizationId = payload.data?.id ?? "";

		expect(payload.error).toBeNull();
		expect(organizationId).toBeString();
		createdOrganizationIds.push(organizationId);

		const [organization] = await db
			.select({
				id: auth_organizations.id,
				name: auth_organizations.name,
				slug: auth_organizations.slug,
			})
			.from(auth_organizations)
			.where(eq(auth_organizations.id, organizationId))
			.limit(1);
		const [membership] = await db
			.select({
				organizationId: auth_organization_members.organizationId,
				userId: auth_organization_members.userId,
			})
			.from(auth_organization_members)
			.where(
				and(
					eq(auth_organization_members.organizationId, organizationId),
					eq(auth_organization_members.userId, testData.userId),
				),
			)
			.limit(1);

		expect(organization).toEqual({
			id: organizationId,
			name: "Created Organization",
			slug,
		});
		expect(membership).toEqual({
			organizationId,
			userId: testData.userId,
		});
	});

	test("uploads a logo and forwards the generated logo URL to organization creation", async () => {
		const testData = requireTestData();
		const mockedOrganizationId = crypto.randomUUID();
		let capturedCreateOrganizationBody:
			| {
					logo?: string;
					name: string;
					slug: string;
					userId: string;
			  }
			| undefined;
		let capturedStorageContentType: string | undefined;
		let capturedStorageKey: string | undefined;
		let capturedStorageSize = 0;

		auth.api.createOrganization = createOrganizationMock(({ body }) => {
			capturedCreateOrganizationBody = body;

			return {
				id: mockedOrganizationId,
			};
		});
		(
			env as typeof env & {
				STORAGE: StorageBinding;
			}
		).STORAGE = {
			...(originalStorage ?? ({} as StorageBinding)),
			put: mock((key, value, options) => {
				capturedStorageKey = key;
				capturedStorageContentType = options?.httpMetadata?.contentType;
				capturedStorageSize =
					value instanceof Uint8Array ? value.byteLength : String(value).length;

				return Promise.resolve({
					key,
				} as R2Object);
			}) as StorageBinding["put"],
		} as StorageBinding;

		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				logo: {
					contentType: "image/png",
					data: TINY_PNG_BASE64,
				},
				name: "Logo Organization",
				slug: `logo-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(200);

		const payload = (await response.json()) as OrganizationCreateResponse;

		expect(payload).toEqual({
			data: {
				id: mockedOrganizationId,
			},
			error: null,
		});
		expect(capturedStorageKey?.startsWith("logos/")).toBeTrue();
		expect(capturedStorageContentType).toBe("image/png");
		expect(capturedStorageSize).toBeGreaterThan(0);
		expect(capturedCreateOrganizationBody).toEqual({
			logo: expect.stringMatching(LOCAL_LOGO_URL_PATTERN),
			name: "Logo Organization",
			slug: expect.stringMatching(LOGO_SLUG_PATTERN),
			userId: testData.userId,
		});
	});

	test("rejects standalone logo uploads without an active organization", async () => {
		const testData = requireTestData();

		const response = await app.request("/v1/auth/orgs/logo", {
			body: JSON.stringify({
				logo: {
					contentType: "image/png",
					data: TINY_PNG_BASE64,
				},
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(403);
	});

	test("allows active organization admins to upload a standalone logo", async () => {
		const activeSession = await setupSessionAuth({
			withActiveOrganization: true,
		});
		let capturedStorageKey: string | undefined;

		(
			env as typeof env & {
				STORAGE: StorageBinding;
			}
		).STORAGE = {
			...(originalStorage ?? ({} as StorageBinding)),
			put: mock((key) => {
				capturedStorageKey = key;

				return Promise.resolve({
					key,
				} as R2Object);
			}) as StorageBinding["put"],
		} as StorageBinding;

		try {
			const response = await app.request("/v1/auth/orgs/logo", {
				body: JSON.stringify({
					logo: {
						contentType: "image/png",
						data: TINY_PNG_BASE64,
					},
				}),
				headers: createJsonHeaders(activeSession.sessionCookie),
				method: "POST",
			});

			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				data: { logo: string };
				error: null;
			};

			expect(payload.error).toBeNull();
			expect(payload.data.logo).toMatch(LOCAL_LOGO_URL_PATTERN);
			expect(capturedStorageKey?.startsWith("logos/")).toBeTrue();
		} finally {
			await teardownSessionAuth(activeSession);
		}
	});

	test("returns a structured internal error when organization creation fails", async () => {
		const testData = requireTestData();

		auth.api.createOrganization = createOrganizationMock(async () => {
			throw new Error("organization_create_failed");
		});

		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				name: "Broken Organization",
				slug: `broken-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(500);

		const payload = (await response.json()) as OrganizationCreateResponse;

		expect(payload).toEqual({
			data: null,
			error: {
				code: "INTERNAL_SERVER_ERROR",
				docs: "https://kayle.id/docs/api/errors#internal_server_error",
				hint: "Please try again in a few moments.",
				message: "Failed to create organization.",
			},
		});
	});

	test("returns a 400 with the validator message when logo data is invalid base64", async () => {
		const testData = requireTestData();

		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				logo: {
					contentType: "image/png",
					data: "%%%invalid-base64%%%",
				},
				name: "Invalid Logo Organization",
				slug: `invalid-logo-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(400);

		const payload = (await response.json()) as OrganizationCreateResponse;

		expect(payload.error?.code).toBe("INVALID_LOGO");
		expect(payload.error?.message).toBe(
			"Organization logo data must be base64 encoded.",
		);
	});

	test("rejects a logo whose content-type does not match its magic bytes", async () => {
		const testData = requireTestData();

		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				logo: {
					contentType: "image/jpeg",
					data: TINY_PNG_BASE64,
				},
				name: "Spoofed Logo Organization",
				slug: `spoofed-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(400);

		const payload = (await response.json()) as OrganizationCreateResponse;

		expect(payload.error?.code).toBe("INVALID_LOGO");
		expect(payload.error?.message).toBe(
			"Organization logo content type does not match the file contents.",
		);
	});

	test("rejects a logo whose dimensions cannot be read", async () => {
		const testData = requireTestData();

		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				logo: {
					contentType: "image/png",
					data: TRUNCATED_PNG_BASE64,
				},
				name: "Truncated Logo Organization",
				slug: `truncated-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(400);

		const payload = (await response.json()) as OrganizationCreateResponse;

		expect(payload.error?.code).toBe("INVALID_LOGO");
		expect(payload.error?.message).toBe(
			"Organization logo dimensions could not be read.",
		);
	});

	test("rejects a logo whose dimensions exceed the maximum", async () => {
		const testData = requireTestData();

		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				logo: {
					contentType: "image/png",
					data: OVERSIZED_PNG_BASE64,
				},
				name: "Oversized Logo Organization",
				slug: `oversized-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(400);

		const payload = (await response.json()) as OrganizationCreateResponse;

		expect(payload.error?.code).toBe("INVALID_LOGO");
		expect(payload.error?.message).toBe(
			"Organization logo dimensions exceed the maximum size.",
		);
	});

	test("rejects a logo content-type outside the allowlist", async () => {
		const testData = requireTestData();

		const response = await app.request("/v1/auth/orgs", {
			body: JSON.stringify({
				logo: {
					contentType: "image/svg+xml",
					data: btoa("<svg/>"),
				},
				name: "SVG Logo Organization",
				slug: `svg-${crypto.randomUUID()}`,
			}),
			headers: createJsonHeaders(testData.sessionCookie),
			method: "POST",
		});

		expect(response.status).toBe(400);
	});
});
