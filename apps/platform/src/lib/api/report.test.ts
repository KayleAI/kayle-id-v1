import { afterEach, describe, expect, test, vi } from "vitest";
import {
	fetchReportableOrganization,
	searchReportableOrganizations,
	submitPublicOrganizationReport,
} from "./report";

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

describe("report API client", () => {
	test("searches organizations through the platform report proxy", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: { organizations: [] },
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await searchReportableOrganizations("acme corp");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/report/organizations?query=acme+corp",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});

	test("loads one reportable organization by identifier", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: {
					organization: {
						description: null,
						id: "00000000-0000-4000-8000-000000000123",
						logo: null,
						name: "Acme Corp",
						slug: "acme-corp",
						verified_apex_domains: [],
						website: null,
					},
				},
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await fetchReportableOrganization("acme corp");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/report/organizations/acme%20corp",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});

	test("submits organization reports through the platform report proxy", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: { report_id: "orpt_report123" },
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await submitPublicOrganizationReport({
			details: "The privacy notice looks wrong.",
			organization_id: "00000000-0000-4000-8000-000000000123",
			reason: "privacy_concern",
			session_id: "vs_session123",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/report/organization-reports",
			expect.objectContaining({
				body: JSON.stringify({
					details: "The privacy notice looks wrong.",
					organization_id: "00000000-0000-4000-8000-000000000123",
					reason: "privacy_concern",
					session_id: "vs_session123",
				}),
				credentials: "include",
				method: "POST",
			}),
		);
	});
});
