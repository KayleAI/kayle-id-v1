import { afterEach, describe, expect, test, vi } from "vitest";
import {
	fetchPublicOrganization,
	type PublicOrganization,
	searchPublicOrganizations,
} from "./public-organizations";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

function mockJsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		headers: {
			"Content-Type": "application/json",
		},
		status,
	});
}

function makePublicOrganization(
	overrides: Pick<PublicOrganization, "id" | "name" | "slug">,
): PublicOrganization {
	return {
		business_jurisdiction: null,
		business_name: null,
		business_registration_number: null,
		business_type: null,
		description: null,
		integration_terms_accepted: true,
		logo: null,
		owner_id_check_completed: true,
		privacy_policy_url: null,
		rp_fallback: {
			appeal_url: null,
			complaints_url: null,
			fallback_idv_url: null,
			support_email: null,
		},
		terms_of_service_url: null,
		verified_apex_domains: [],
		website: null,
		...overrides,
	};
}

describe("public organizations API client", () => {
	test("searches organizations through the public organizations proxy", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					organizations: [],
					pagination: {
						has_next_page: false,
						has_previous_page: false,
						page: 1,
						page_size: 10,
					},
				},
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await searchPublicOrganizations("acme corp");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/organizations?query=acme+corp",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});

	test("requests paginated organizations through the public organizations proxy", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					organizations: [],
					pagination: {
						has_next_page: true,
						has_previous_page: true,
						page: 2,
						page_size: 10,
					},
				},
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const result = await searchPublicOrganizations("", 2);

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/organizations?page=2",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
		expect(result.pagination).toEqual({
			has_next_page: true,
			has_previous_page: true,
			page: 2,
			page_size: 10,
		});
	});

	test("preserves the API organization order", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					organizations: [
						makePublicOrganization({
							id: "00000000-0000-4000-8000-000000000003",
							name: "Zeta Studio",
							slug: "zeta-studio",
						}),
						makePublicOrganization({
							id: "00000000-0000-4000-8000-000000000001",
							name: "Acme Corp",
							slug: "acme-corp",
						}),
						makePublicOrganization({
							id: "00000000-0000-4000-8000-000000000002",
							name: "beta Labs",
							slug: "beta-labs",
						}),
					],
					pagination: {
						has_next_page: false,
						has_previous_page: false,
						page: 1,
						page_size: 10,
					},
				},
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const result = await searchPublicOrganizations("a");

		expect(
			result.organizations.map((organization) => organization.name),
		).toEqual(["Zeta Studio", "Acme Corp", "beta Labs"]);
	});

	test("loads one public organization by identifier", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					organization: {
						business_jurisdiction: null,
						business_name: null,
						business_registration_number: null,
						business_type: null,
						description: null,
						id: "00000000-0000-4000-8000-000000000123",
						integration_terms_accepted: true,
						logo: null,
						name: "Acme Corp",
						owner_id_check_completed: true,
						privacy_policy_url: null,
						rp_fallback: {
							appeal_url: null,
							complaints_url: null,
							fallback_idv_url: null,
							support_email: null,
						},
						slug: "acme-corp",
						terms_of_service_url: null,
						verified_apex_domains: [],
						website: null,
					},
				},
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await fetchPublicOrganization("acme corp");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/organizations/acme%20corp",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});
});
