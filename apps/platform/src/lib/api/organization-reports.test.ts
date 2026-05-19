import { afterEach, describe, expect, test, vi } from "vitest";
import {
	fetchOrganizationReport,
	fetchOrganizationReports,
	updateOrganizationReport,
} from "./organization-reports";

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

describe("organization reports API client", () => {
	test("lists organization reports with filters and search", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: { reports: [] },
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await fetchOrganizationReports({
			query: "acme",
			reason: "privacy_concern",
			status: "open",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/admin/organization-reports?query=acme&reason=privacy_concern&status=open",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});

	test("loads one organization report", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: { report: { id: "orpt_report123" } },
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await fetchOrganizationReport("orpt_report123");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/admin/organization-reports/orpt_report123",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			}),
		);
	});

	test("updates one organization report", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockJsonResponse({
				data: { report: { id: "orpt_report123" } },
				error: null,
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await updateOrganizationReport({
			admin_note: "Reviewing.",
			id: "orpt_report123",
			status: "investigating",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/admin/organization-reports/orpt_report123",
			expect.objectContaining({
				body: JSON.stringify({
					admin_note: "Reviewing.",
					status: "investigating",
				}),
				credentials: "include",
				method: "PATCH",
			}),
		);
	});
});
