/**
 * @vitest-environment jsdom
 */
import { VERIFY_HANDOFF_COPY } from "@kayle-id/translations/verify-handoff-copy";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const requestCancelVerifySessionMock = vi.fn();
const requestVerifySessionDetailsMock = vi.fn();
const requestVerifySessionStatusMock = vi.fn();

vi.mock("@kayleai/ui/button", () => ({
	Button: ({
		children,
		disabled,
		onClick,
		render,
		type = "button",
	}: {
		children: React.ReactNode;
		disabled?: boolean;
		onClick?: () => void;
		render?: React.ReactNode;
		type?: "button" | "submit";
	}) =>
		render ? (
			render
		) : (
			<button disabled={disabled} onClick={onClick} type={type}>
				{children}
			</button>
		),
}));

vi.mock("@kayleai/ui/logo", () => ({
	Logo: () => <div>Kayle ID</div>,
}));

vi.mock("@tanstack/react-router", () => ({
	useLoaderData: () => ({
		sessionId: "vs_session123",
	}),
}));

vi.mock("@/i18n/provider", () => ({
	useVerifyHandoffCopy: () => VERIFY_HANDOFF_COPY,
}));

vi.mock("@/config/handoff", () => ({
	requestCancelVerifySession: (sessionId: string, cancelToken: string) =>
		requestCancelVerifySessionMock(sessionId, cancelToken),
	requestVerifySessionDetails: (sessionId: string) =>
		requestVerifySessionDetailsMock(sessionId),
	requestVerifySessionStatus: (sessionId: string) =>
		requestVerifySessionStatusMock(sessionId),
}));

import {
	buildPrivacyRequestMailtoHref,
	buildPrivacyRequestPath,
	PrivacyRequestPage,
} from "./privacy-request";

function createSessionDetails() {
	return {
		age_threshold: null,
		is_age_only: false,
		organization_business_jurisdiction: null,
		organization_business_name: null,
		organization_business_registration_number: null,
		organization_business_type: null,
		organization_description: null,
		organization_logo: null,
		organization_name: "Test Organization",
		organization_owner_id_check_completed: true,
		organization_privacy_policy_url: null,
		organization_terms_of_service_url: null,
		organization_verified_apex_domains: ["test.example"],
		organization_website: null,
		rp_fallback: {
			appeal_url: null,
			complaints_url: null,
			fallback_idv_url: null,
			support_email: "support@test.example",
		},
		session_id: "vs_session123",
		share_fields: {},
	};
}

function createSessionStatus() {
	return {
		completed_at: null,
		is_terminal: false,
		latest_attempt: {
			completed_at: null,
			failure_code: null,
			handoff_claimed: false,
			id: "va_attempt123",
			retry_allowed: true,
			status: "in_progress",
		},
		redirect_url: null,
		same_device_only: false,
		session_id: "vs_session123",
		status: "in_progress",
	};
}

beforeEach(() => {
	requestCancelVerifySessionMock.mockReset();
	requestVerifySessionDetailsMock.mockReset();
	requestVerifySessionStatusMock.mockReset();
	requestVerifySessionDetailsMock.mockResolvedValue(createSessionDetails());
	requestVerifySessionStatusMock.mockResolvedValue(createSessionStatus());
	window.history.replaceState(
		{},
		"",
		"/privacy/vs_session123?cancel_token=ct_cancel_token",
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("privacy request helpers", () => {
	test("builds a privacy request route that preserves the cancel token", () => {
		expect(
			buildPrivacyRequestPath({
				cancelToken: "ct_cancel_token",
				sessionId: "vs_session123",
			}),
		).toBe("/privacy/vs_session123?cancel_token=ct_cancel_token");
	});

	test("builds mailto content scoped to the session and attempt", () => {
		const href = buildPrivacyRequestMailtoHref({
			attemptId: "va_attempt123",
			email: "help@kayle.id",
			organizationName: "Test Organization",
			sessionId: "vs_session123",
		});
		const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));

		expect(href.startsWith("mailto:help@kayle.id?")).toBe(true);
		expect(params.get("subject")).toBe(
			"Kayle ID privacy request for vs_session123",
		);
		expect(params.get("body")).toContain("Session ID: vs_session123");
		expect(params.get("body")).toContain("Latest attempt ID: va_attempt123");
		expect(params.get("body")).toContain("Organization: Test Organization");
	});
});

describe("PrivacyRequestPage", () => {
	test("renders session-scoped Kayle and RP request links", async () => {
		render(<PrivacyRequestPage />);

		await waitFor(() => {
			expect(screen.getByText("va_attempt123")).not.toBeNull();
		});

		const kayleLink = screen.getByRole("link", {
			name: VERIFY_HANDOFF_COPY.privacyRequest.kayleEmailButton,
		});
		const rpLink = screen.getByRole("link", {
			name: "Email Test Organization",
		});
		const kayleParams = new URLSearchParams(
			kayleLink.getAttribute("href")?.split("?")[1] ?? "",
		);
		const rpParams = new URLSearchParams(
			rpLink.getAttribute("href")?.split("?")[1] ?? "",
		);

		expect(kayleParams.get("body")).toContain("Session ID: vs_session123");
		expect(rpParams.get("body")).toContain("Latest attempt ID: va_attempt123");
		expect(requestVerifySessionDetailsMock).toHaveBeenCalledWith(
			"vs_session123",
		);
		expect(requestVerifySessionStatusMock).toHaveBeenCalledWith(
			"vs_session123",
		);
	});

	test("stops the check with the session cancel token", async () => {
		requestCancelVerifySessionMock.mockResolvedValue(undefined);

		render(<PrivacyRequestPage />);

		fireEvent.click(
			screen.getByRole("button", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.cancelButton,
			}),
		);

		await waitFor(() => {
			expect(requestCancelVerifySessionMock).toHaveBeenCalledWith(
				"vs_session123",
				"ct_cancel_token",
			);
		});
		expect(
			screen.getByText(VERIFY_HANDOFF_COPY.privacyRequest.cancelSuccess),
		).not.toBeNull();
	});
});
