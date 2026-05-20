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

vi.mock("@kayleai/ui/button", () => ({
	Button: ({
		children,
		className,
		disabled,
		onClick,
		render,
		type = "button",
	}: {
		children: React.ReactNode;
		className?: string;
		disabled?: boolean;
		onClick?: () => void;
		render?: React.ReactNode;
		type?: "button" | "submit";
	}) =>
		render ? (
			render
		) : (
			<button
				className={className}
				disabled={disabled}
				onClick={onClick}
				type={type}
			>
				{children}
			</button>
		),
}));

vi.mock("@kayleai/ui/logo", () => ({
	Logo: () => <div>Kayle ID</div>,
}));

vi.mock("@kayleai/ui/dialog", async () => {
	const React = await import("react");
	const { createPortal } = await import("react-dom");
	const DialogContext = React.createContext<{
		open: boolean;
		setOpen: (open: boolean) => void;
	}>({
		open: false,
		setOpen: () => {},
	});

	function Dialog({
		children,
		onOpenChange,
		open,
	}: {
		children: React.ReactNode;
		onOpenChange?: (open: boolean) => void;
		open?: boolean;
	}) {
		const [internalOpen, setInternalOpen] = React.useState(false);
		const isOpen = open ?? internalOpen;
		const setOpen = onOpenChange ?? setInternalOpen;
		return (
			<DialogContext.Provider value={{ open: isOpen, setOpen }}>
				{children}
			</DialogContext.Provider>
		);
	}

	function DialogTrigger({
		children,
		className,
	}: {
		children: React.ReactNode;
		className?: string;
		render?: React.ReactElement;
	}) {
		const { setOpen } = React.useContext(DialogContext);
		return (
			<button className={className} onClick={() => setOpen(true)} type="button">
				{children}
			</button>
		);
	}

	function DialogContent({ children }: { children: React.ReactNode }) {
		const { open } = React.useContext(DialogContext);
		return open
			? createPortal(<div role="dialog">{children}</div>, document.body)
			: null;
	}

	function PassThrough({ children }: { children?: React.ReactNode }) {
		return <>{children}</>;
	}

	return {
		Dialog,
		DialogTrigger,
		DialogContent,
		DialogHeader: PassThrough,
		DialogTitle: ({ children }: { children?: React.ReactNode }) => (
			<h2>{children}</h2>
		),
		DialogDescription: PassThrough,
		DialogFooter: ({ children }: { children?: React.ReactNode }) => (
			<div>{children}</div>
		),
	};
});

vi.mock("@/i18n/provider", () => ({
	useVerifyHandoffCopy: () => VERIFY_HANDOFF_COPY,
}));

vi.mock("@/config/handoff", () => ({
	requestCancelVerifySession: (sessionId: string, cancelToken: string) =>
		requestCancelVerifySessionMock(sessionId, cancelToken),
}));

import { buildOrganizationReportUrl } from "./app/organization-report-dialog";
import {
	buildPrivacyRequestMailtoHref,
	buildPrivacyRequestPath,
	PrivacyRequestPage,
	type PrivacyRequestRouteContext,
} from "./privacy-request";

function createFoundContext(
	overrides: Partial<
		Extract<PrivacyRequestRouteContext, { kind: "found" }>
	> = {},
): Extract<PrivacyRequestRouteContext, { kind: "found" }> {
	return {
		kind: "found",
		has_withdrawn_consent: false,
		is_terminal: false,
		organization_id: "00000000-0000-4000-8000-000000000123",
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
		organization_website: "https://test.example",
		rp_fallback: {
			appeal_url: null,
			complaints_url: null,
			fallback_idv_url: null,
			support_email: "support@test.example",
		},
		result_webhook_deliveries: {
			succeeded_count: 0,
			total_count: 0,
			undelivered_count: 0,
		},
		session_id: "vs_session123",
		status: "in_progress",
		...overrides,
	};
}

function renderPrivacyRequestPage({
	cancelToken = null,
	context = createFoundContext(),
}: {
	cancelToken?: string | null;
	context?: PrivacyRequestRouteContext;
} = {}) {
	return render(
		<PrivacyRequestPage cancelToken={cancelToken} context={context} />,
	);
}

function expectTextContent(textContent: string): void {
	expect(
		screen.getByText(
			(_content, element) => element?.textContent === textContent,
		),
	).not.toBeNull();
}

beforeEach(() => {
	requestCancelVerifySessionMock.mockReset();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("privacy options helpers", () => {
	test("builds a privacy options route that preserves the cancel token", () => {
		expect(
			buildPrivacyRequestPath({
				cancelToken: "ct_cancel_token",
				sessionId: "vs_session123",
			}),
		).toBe("/vs_session123/privacy?cancel_token=ct_cancel_token");
	});

	test("builds organization mailto content scoped to the session", () => {
		const href = buildPrivacyRequestMailtoHref({
			email: "support@test.example",
			organizationName: "Test Organization",
			sessionId: "vs_session123",
		});
		const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));

		expect(href.startsWith("mailto:support@test.example?")).toBe(true);
		expect(params.get("subject")).toBe(
			"Kayle ID privacy options for vs_session123",
		);
		expect(params.get("body")).toContain(
			"I am using the Kayle ID privacy options for this check.",
		);
		expect(params.get("body")).toContain("Session ID: vs_session123");
		expect(params.get("body")).toContain("Organization: Test Organization");
	});
});

describe("PrivacyRequestPage", () => {
	test("does not show organization contact before a result delivery succeeds", () => {
		renderPrivacyRequestPage();

		expect(
			screen.getByText(VERIFY_HANDOFF_COPY.privacyRequest.activeDescription),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.statusHeading,
			}),
		).not.toBeNull();
		expect(
			screen
				.getByRole("link", {
					name: VERIFY_HANDOFF_COPY.privacyRequest.learnMoreLink,
				})
				.getAttribute("href"),
		).toBe("https://kayle.id");
		expect(
			screen.queryByRole("link", {
				name: "Email Test Organization",
			}),
		).toBeNull();
		expect(screen.queryByText("Reference for this request")).toBeNull();
		expect(
			screen.queryByRole("link", {
				name: /Kayle ID privacy team/i,
			}),
		).toBeNull();
	});

	test("does not promise deleted data for active sessions without organization details", () => {
		renderPrivacyRequestPage({
			context: createFoundContext({
				organization_name: null,
				rp_fallback: {
					appeal_url: null,
					complaints_url: null,
					fallback_idv_url: null,
					support_email: null,
				},
			}),
		});

		expect(
			screen.getByRole("heading", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.notFoundHeading,
			}),
		).not.toBeNull();
		expect(
			screen.getByText(
				VERIFY_HANDOFF_COPY.privacyRequest.unavailableActiveDescription,
			),
		).not.toBeNull();
		expect(
			screen.queryByText(/Kayle ID no longer has your document/i),
		).toBeNull();
	});

	test("renders organization contact only after a result delivery succeeded", () => {
		renderPrivacyRequestPage({
			cancelToken: "ct_cancel_token",
			context: createFoundContext({
				is_terminal: true,
				result_webhook_deliveries: {
					succeeded_count: 1,
					total_count: 1,
					undelivered_count: 0,
				},
				status: "completed",
			}),
		});

		const rpLink = screen.getByRole("link", {
			name: "Email Test Organization",
		});
		const rpParams = new URLSearchParams(
			rpLink.getAttribute("href")?.split("?")[1] ?? "",
		);

		expect(rpParams.get("body")).toContain("Session ID: vs_session123");
		expectTextContent(
			"This check is already finished. Kayle ID no longer has your document, selfie, or personal details. Test Organization has already received your data.",
		);
		expect(
			screen.getByRole("heading", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.terminalHeading,
			}),
		).not.toBeNull();
		expect(
			screen.queryByRole("button", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.cancelButton,
			}),
		).toBeNull();
		expect(screen.queryByText("Reference for this request")).toBeNull();
		expect(
			screen.queryByRole("link", {
				name: /Kayle ID privacy team/i,
			}),
		).toBeNull();
	});

	test("does not render a withdraw action without a cancellation token", () => {
		renderPrivacyRequestPage();

		expect(
			screen.getByRole("heading", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.statusHeading,
			}),
		).not.toBeNull();
		expect(
			screen.queryByRole("button", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.cancelButton,
			}),
		).toBeNull();
		expect(requestCancelVerifySessionMock).not.toHaveBeenCalled();
	});

	test("renders no Kayle ID email fallback when organization has no support email", () => {
		renderPrivacyRequestPage({
			context: createFoundContext({
				is_terminal: true,
				result_webhook_deliveries: {
					succeeded_count: 1,
					total_count: 1,
					undelivered_count: 0,
				},
				rp_fallback: {
					appeal_url: null,
					complaints_url: null,
					fallback_idv_url: null,
					support_email: null,
				},
				status: "completed",
			}),
		});

		expect(
			screen.queryByRole("link", {
				name: "Email Test Organization",
			}),
		).toBeNull();
		expectTextContent(
			"Test Organization controls the data they received. Please contact them for access or deletion there.",
		);
		expect(
			screen.queryByRole("link", {
				name: /Kayle ID privacy team/i,
			}),
		).toBeNull();
	});

	test("opens organization details from the privacy copy", () => {
		renderPrivacyRequestPage({
			context: createFoundContext({
				is_terminal: true,
				organization_business_name: "Test Organization Ltd",
				organization_business_jurisdiction: "GB",
				organization_business_registration_number: "12345678",
				result_webhook_deliveries: {
					succeeded_count: 1,
					total_count: 1,
					undelivered_count: 0,
				},
				status: "completed",
			}),
		});

		const organizationTriggers = screen.getAllByRole("button", {
			name: "Test Organization",
		});
		expect(organizationTriggers.length).toBeGreaterThan(0);

		fireEvent.click(organizationTriggers[0] as HTMLButtonElement);

		expect(screen.getByRole("dialog")).not.toBeNull();
		expect(
			screen.getByRole("heading", { name: "About Test Organization" }),
		).not.toBeNull();
		expect(screen.getByText("Test Organization Ltd")).not.toBeNull();
	});

	test("links to the platform report page from privacy options", () => {
		renderPrivacyRequestPage();

		const reportLink = screen.getByRole("link", {
			name: "Report organization",
		});

		expect(reportLink.getAttribute("href")).toBe(
			buildOrganizationReportUrl({
				orgId: "00000000-0000-4000-8000-000000000123",
				sessionId: "vs_session123",
				sourceHostname: window.location.hostname,
			}),
		);
	});

	test("explains terminal checks with undelivered result webhooks", () => {
		renderPrivacyRequestPage({
			cancelToken: "ct_cancel_token",
			context: createFoundContext({
				is_terminal: true,
				result_webhook_deliveries: {
					succeeded_count: 0,
					total_count: 1,
					undelivered_count: 1,
				},
				status: "completed",
			}),
		});

		expectTextContent(
			"This check is already finished. Kayle ID no longer has your document, selfie, or personal details. Test Organization has not received the result, and withdrawal can delete the undelivered encrypted result now.",
		);
		expect(
			screen.getByRole("button", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.cancelButton,
			}),
		).not.toBeNull();
		expect(
			screen.getByRole("heading", {
				level: 1,
				name: VERIFY_HANDOFF_COPY.privacyRequest.heading,
			}),
		).not.toBeNull();
	});

	test("renders a not-found privacy page without request actions", () => {
		renderPrivacyRequestPage({
			context: {
				kind: "not_found",
				session_id: "vs_session123",
			},
		});

		expect(
			screen.getByRole("heading", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.notFoundHeading,
			}),
		).not.toBeNull();
		expect(
			screen.getByText(VERIFY_HANDOFF_COPY.privacyRequest.notFoundDescription),
		).not.toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
		expect(
			screen.getByRole("link", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.learnMoreLink,
			}),
		).not.toBeNull();
	});

	test("shows pending and success states while withdrawing consent", async () => {
		let resolveCancelSession: (() => void) | undefined;
		requestCancelVerifySessionMock.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveCancelSession = resolve;
			}),
		);

		renderPrivacyRequestPage({
			cancelToken: "ct_cancel_token",
		});

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
		const pendingButton = screen.getByRole("button", {
			name: VERIFY_HANDOFF_COPY.privacyRequest.cancelPendingButton,
		}) as HTMLButtonElement;
		expect(pendingButton.disabled).toBe(true);

		resolveCancelSession?.();

		expect(
			await screen.findByRole("button", {
				name: VERIFY_HANDOFF_COPY.privacyRequest.cancelSuccess,
			}),
		).not.toBeNull();
		const successButton = screen.getByRole("button", {
			name: VERIFY_HANDOFF_COPY.privacyRequest.cancelSuccess,
		}) as HTMLButtonElement;
		expect(successButton.disabled).toBe(true);
		expect(successButton.className).toContain("emerald");
	});
});
