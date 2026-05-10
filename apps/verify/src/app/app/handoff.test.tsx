/**
 * @vitest-environment jsdom
 */

import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import type React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
	HandoffPayload,
	VerifySessionStatusPayload,
} from "@/config/handoff";

if (typeof document === "undefined") {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "http://localhost/",
	});

	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: dom.window,
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: dom.window.document,
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	Object.defineProperty(globalThis, "HTMLElement", {
		configurable: true,
		value: dom.window.HTMLElement,
	});
	Object.defineProperty(globalThis, "Node", {
		configurable: true,
		value: dom.window.Node,
	});
	Object.defineProperty(globalThis, "MutationObserver", {
		configurable: true,
		value: dom.window.MutationObserver,
	});
}

const mockedUseDevice = vi.fn();
const qrPropsSpy = vi.fn();
const assignLocationSpy = vi.fn();
const closeSpy = vi.fn();
const mockedUseSession = vi.fn();
const requestCancelVerifySessionMock = vi.fn();
const requestHandoffPayloadMock = vi.fn();
const requestVerifySessionStatusMock = vi.fn();
const requestVerifyRedirectPermittedMock = vi.fn();
const REDIRECT_COUNTDOWN_TEXT = /Redirecting in 3 seconds\./;
const SELFIE_FAILURE_CLOSE_PAGE_TEXT = `${VERIFY_HANDOFF_COPY.screens.terminal.selfieFaceMismatch.description} ${VERIFY_HANDOFF_COPY.screens.terminal.youCanCloseDescription}`;

vi.mock("@tanstack/react-router", () => ({
	useLoaderData: () => ({
		sessionId: "vs_session123",
	}),
}));

vi.mock("@/utils/use-device", () => ({
	useDevice: () => mockedUseDevice(),
}));

vi.mock("@/utils/navigation", () => ({
	redirectToUrl: (targetUrl: string) => assignLocationSpy(targetUrl),
}));

vi.mock("../session-provider", () => ({
	useSession: () => mockedUseSession(),
}));

vi.mock("@/config/handoff", () => ({
	requestCancelVerifySession: (sessionId: string, cancelToken: string) =>
		requestCancelVerifySessionMock(sessionId, cancelToken),
	requestHandoffPayload: (sessionId: string) =>
		requestHandoffPayloadMock(sessionId),
	requestVerifyRedirectPermitted: (sessionId: string) =>
		requestVerifyRedirectPermittedMock(sessionId),
	requestVerifySessionStatus: (sessionId: string) =>
		requestVerifySessionStatusMock(sessionId),
}));

vi.mock("@/config/env", () => ({
	getApiHttpBaseUrl: () => "https://api.example.test",
}));

vi.mock("@kayleai/ui/button", () => ({
	Button: ({
		children,
		nativeButton = true,
		onClick,
		render: renderNode,
		type = "button",
	}: {
		children: React.ReactNode;
		nativeButton?: boolean;
		onClick?: () => void;
		render?: React.ReactNode;
		type?: "button" | "submit";
	}) => {
		const linkRender = renderNode;

		return nativeButton === false && linkRender ? (
			linkRender
		) : (
			<button onClick={onClick} type={type}>
				{children}
			</button>
		);
	},
}));

vi.mock("@kayleai/ui/alert-dialog", async () => {
	const react = await import("react");
	const DialogContext = react.createContext<{
		onOpenChange: (open: boolean) => void;
	}>({
		onOpenChange: () => {},
	});

	return {
		AlertDialog: ({
			children,
			onOpenChange,
			open,
		}: {
			children: React.ReactNode;
			onOpenChange?: (open: boolean) => void;
			open?: boolean;
		}) =>
			open ? (
				<DialogContext.Provider
					value={{ onOpenChange: onOpenChange ?? (() => {}) }}
				>
					<div data-testid="cancel-dialog" role="alertdialog">
						{children}
					</div>
				</DialogContext.Provider>
			) : null,
		AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
		AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
		AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
		AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
			<h2>{children}</h2>
		),
		AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
			<p>{children}</p>
		),
		AlertDialogAction: ({
			children,
			disabled,
			onClick,
		}: {
			children: React.ReactNode;
			disabled?: boolean;
			onClick?: () => void;
		}) => (
			<button disabled={disabled} onClick={onClick} type="button">
				{children}
			</button>
		),
		AlertDialogCancel: ({
			children,
			disabled,
		}: {
			children: React.ReactNode;
			disabled?: boolean;
		}) => {
			const { onOpenChange } = react.useContext(DialogContext);
			return (
				<button
					disabled={disabled}
					onClick={() => onOpenChange(false)}
					type="button"
				>
					{children}
				</button>
			);
		},
	};
});

vi.mock("@kayle-id/ui/info-card", () => ({
	default: ({
		buttons,
		children,
		header,
		message,
	}: {
		buttons?: {
			primary?: {
				label: string;
				onClick?: () => void;
			};
			secondary?: {
				label: string;
				onClick?: () => void;
			};
		};
		children?: React.ReactNode;
		header: {
			description: string;
			title: string;
		};
		message: {
			description: string;
			title: string;
		};
	}) => (
		<div>
			<h1>{header.title}</h1>
			<p>{header.description}</p>
			<h2>{message.title}</h2>
			<p>{message.description}</p>
			{children}
			{buttons?.primary ? (
				<button onClick={buttons.primary.onClick} type="button">
					{buttons.primary.label}
				</button>
			) : null}
			{buttons?.secondary ? (
				<button onClick={buttons.secondary.onClick} type="button">
					{buttons.secondary.label}
				</button>
			) : null}
		</div>
	),
}));

vi.mock("qrcode.react", () => ({
	QRCodeSVG: ({ value }: { value: string }) => {
		qrPropsSpy(value);
		return <div data-testid="qr-code" data-value={value} />;
	},
}));

import { Handoff } from "./handoff";

function createHandoffPayload(
	overrides: Partial<HandoffPayload> = {},
): HandoffPayload {
	return {
		v: 1,
		session_id: "vs_session123",
		attempt_id: "va_attempt123",
		mobile_write_token: "token_123",
		expires_at: "2099-01-01T00:00:00.000Z",
		...overrides,
	};
}

function createSessionStatus(
	overrides: Partial<VerifySessionStatusPayload> = {},
): VerifySessionStatusPayload {
	return {
		completed_at: null,
		is_terminal: false,
		latest_attempt: {
			completed_at: null,
			failure_code: null,
			handoff_claimed: false,
			id: "va_attempt123",
			retry_allowed: false,
			status: "in_progress",
		},
		redirect_url: null,
		session_id: "vs_session123",
		same_device_only: false,
		status: "created",
		...overrides,
	};
}

function createVerifyRequestError(
	code: string,
	message: string,
): Error & { code: string } {
	const error = new Error(message) as Error & { code: string };
	error.code = code;
	return error;
}

async function flushUi(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
	await act(async () => {
		await Promise.resolve();
	});
}

beforeEach(() => {
	mockedUseDevice.mockReset();
	mockedUseSession.mockReset();
	qrPropsSpy.mockReset();
	assignLocationSpy.mockReset();
	closeSpy.mockReset();
	requestCancelVerifySessionMock.mockReset();
	requestHandoffPayloadMock.mockReset();
	requestVerifySessionStatusMock.mockReset();
	requestVerifyRedirectPermittedMock.mockReset();
	requestVerifyRedirectPermittedMock.mockResolvedValue({
		permitted: true,
		redirect_url: null,
	});
	mockedUseSession.mockReturnValue({
		sessionStatus: null,
	});
	Object.defineProperty(window, "close", {
		configurable: true,
		value: closeSpy,
	});
	// Default URL search includes the cancel token. Tests that need to
	// simulate a missing token can call window.history.replaceState with a
	// different query.
	window.history.replaceState({}, "", "/?cancel_token=ct_cancel_token");
	vi.restoreAllMocks();
	vi.useRealTimers();
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
	vi.useRealTimers();
});

describe("Handoff", () => {
	test("renders the inline handoff screen on entry instead of a separate handoff dialog", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "ios",
		});

		requestHandoffPayloadMock.mockResolvedValue(createHandoffPayload());
		requestVerifySessionStatusMock.mockResolvedValue(createSessionStatus());

		const view = render(<Handoff />);

		expect(await view.findByText("Open Kayle ID on your phone")).not.toBeNull();
		expect(view.queryByText("Unsupported Device")).toBeNull();

		await waitFor(() => {
			expect(requestHandoffPayloadMock).toHaveBeenCalledWith("vs_session123");
			expect(requestVerifySessionStatusMock).toHaveBeenCalledWith(
				"vs_session123",
			);
		});

		const qr = await view.findByTestId("qr-code");
		const qrValue = qr.getAttribute("data-value");
		expect(qrValue).toContain("va_attempt123");
		expect(qrValue).toContain("token_123");

		const openAppLink = view.getByRole("link", {
			name: VERIFY_HANDOFF_COPY.actions.openKayleIdApp,
		});
		expect(openAppLink.getAttribute("href")).toContain("kayle-id://");
		expect(
			view.getByRole("button", { name: VERIFY_HANDOFF_COPY.actions.cancel }),
		).not.toBeNull();
	});

	test("renders a prefetched terminal status without reloading session status first", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});
		mockedUseSession.mockReturnValue({
			sessionStatus: createSessionStatus({
				completed_at: "2099-01-01T00:00:00.000Z",
				is_terminal: true,
				latest_attempt: {
					completed_at: "2099-01-01T00:00:00.000Z",
					failure_code: null,
					handoff_claimed: true,
					id: "va_attempt123",
					retry_allowed: false,
					status: "succeeded",
				},
				status: "completed",
			}),
		});

		const view = render(<Handoff />);

		expect(
			await view.findByText(VERIFY_HANDOFF_COPY.screens.terminal.success.title),
		).not.toBeNull();
		expect(requestVerifySessionStatusMock).not.toHaveBeenCalled();
		expect(requestHandoffPayloadMock).not.toHaveBeenCalled();
	});

	test("hides the handoff QR code once the mobile device connects", async () => {
		vi.useFakeTimers();

		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});

		requestHandoffPayloadMock.mockResolvedValue(createHandoffPayload());
		requestVerifySessionStatusMock
			.mockResolvedValueOnce(createSessionStatus())
			.mockResolvedValueOnce(
				createSessionStatus({
					status: "in_progress",
				}),
			);

		const view = render(<Handoff />);

		await flushUi();
		expect(view.getByTestId("qr-code")).not.toBeNull();

		act(() => {
			vi.advanceTimersByTime(2000);
		});
		await flushUi();

		expect(
			view.getByText(VERIFY_HANDOFF_COPY.screens.connected.headerDescription),
		).not.toBeNull();
		expect(view.queryByTestId("qr-code")).toBeNull();
	});

	test("refreshes the handoff QR every 60 seconds while waiting for a device", async () => {
		vi.useFakeTimers();

		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});

		requestHandoffPayloadMock
			.mockResolvedValueOnce(
				createHandoffPayload({
					attempt_id: "va_attempt_initial",
					mobile_write_token: "token_initial",
				}),
			)
			.mockResolvedValueOnce(
				createHandoffPayload({
					attempt_id: "va_attempt_refreshed",
					mobile_write_token: "token_refreshed",
				}),
			);
		requestVerifySessionStatusMock.mockResolvedValue(createSessionStatus());

		const view = render(<Handoff />);

		await flushUi();
		expect(view.getByTestId("qr-code").getAttribute("data-value")).toContain(
			"va_attempt_initial",
		);

		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		await flushUi();

		expect(requestHandoffPayloadMock).toHaveBeenCalledTimes(2);
		expect(view.getByTestId("qr-code").getAttribute("data-value")).toContain(
			"va_attempt_refreshed",
		);
	});

	test("renders failure state when handoff fetch fails", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});

		requestHandoffPayloadMock.mockRejectedValue(
			new Error("Verification session is expired."),
		);
		requestVerifySessionStatusMock.mockResolvedValue(createSessionStatus());

		const view = render(<Handoff />);

		expect(
			await view.findByText(VERIFY_HANDOFF_COPY.handoff.refreshError),
		).not.toBeNull();
		expect(
			view.getByRole("button", { name: VERIFY_HANDOFF_COPY.actions.cancel }),
		).not.toBeNull();
		expect(view.queryByTestId("qr-code")).toBeNull();
	});

	test("does not fetch a new handoff after the session becomes same-device only", async () => {
		vi.useFakeTimers();

		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});

		requestHandoffPayloadMock.mockResolvedValue(createHandoffPayload());
		requestVerifySessionStatusMock
			.mockResolvedValueOnce(createSessionStatus())
			.mockResolvedValueOnce(
				createSessionStatus({
					latest_attempt: {
						completed_at: "2099-01-01T00:00:00.000Z",
						failure_code: "selfie_face_mismatch",
						handoff_claimed: true,
						id: "va_attempt123",
						retry_allowed: true,
						status: "failed",
					},
					same_device_only: true,
					status: "created",
				}),
			);

		const view = render(<Handoff />);

		await flushUi();
		expect(view.getByTestId("qr-code")).not.toBeNull();

		act(() => {
			vi.advanceTimersByTime(2000);
		});
		await flushUi();

		expect(view.queryByTestId("qr-code")).toBeNull();
		expect(
			view.getByText(VERIFY_HANDOFF_COPY.screens.retryableFailure.headerTitle),
		).not.toBeNull();
		expect(
			view.getByText(
				VERIFY_HANDOFF_COPY.screens.retryableFailure.messageDescription,
			),
		).not.toBeNull();
		expect(
			view.getByRole("button", {
				name: VERIFY_HANDOFF_COPY.actions.closeThisPage,
			}),
		).not.toBeNull();

		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		await flushUi();

		expect(requestHandoffPayloadMock).toHaveBeenCalledTimes(1);
	});

	test("does not request a handoff on first render when the session is already same-device only", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});

		requestVerifySessionStatusMock.mockResolvedValue(
			createSessionStatus({
				latest_attempt: {
					completed_at: "2099-01-01T00:00:00.000Z",
					failure_code: "selfie_face_mismatch",
					handoff_claimed: true,
					id: "va_attempt123",
					retry_allowed: true,
					status: "failed",
				},
				same_device_only: true,
				status: "created",
			}),
		);

		const view = render(<Handoff />);

		await flushUi();

		expect(requestHandoffPayloadMock).not.toHaveBeenCalled();
		expect(view.queryByTestId("qr-code")).toBeNull();
		expect(
			view.getByText(VERIFY_HANDOFF_COPY.screens.retryableFailure.headerTitle),
		).not.toBeNull();
		expect(
			view.getByRole("button", {
				name: VERIFY_HANDOFF_COPY.actions.closeThisPage,
			}),
		).not.toBeNull();
	});

	test("cancels the verification session before mobile has claimed it", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "ios",
		});

		requestCancelVerifySessionMock.mockResolvedValue(undefined);
		requestHandoffPayloadMock.mockResolvedValue(createHandoffPayload());
		requestVerifySessionStatusMock.mockResolvedValue(createSessionStatus());

		const view = render(<Handoff />);

		await flushUi();
		expect(view.getByTestId("qr-code")).not.toBeNull();
		expect(view.queryByTestId("cancel-dialog")).toBeNull();

		act(() => {
			view.getByRole("button", { name: "Cancel" }).click();
		});
		await flushUi();

		expect(view.getByTestId("cancel-dialog")).not.toBeNull();
		expect(
			view.getByText(VERIFY_HANDOFF_COPY.cancelDialog.title),
		).not.toBeNull();
		expect(requestCancelVerifySessionMock).not.toHaveBeenCalled();

		act(() => {
			view
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.cancelDialog.confirm })
				.click();
		});
		await flushUi();

		expect(requestCancelVerifySessionMock).toHaveBeenCalledWith(
			"vs_session123",
			"ct_cancel_token",
		);
		expect(view.queryByTestId("qr-code")).toBeNull();
		expect(view.queryByTestId("cancel-dialog")).toBeNull();
		expect(
			view.getByText(VERIFY_HANDOFF_COPY.screens.terminal.cancelled.title),
		).not.toBeNull();
	});

	test("closes the browser locally instead of cancelling a same-device session", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "ios",
		});

		requestVerifySessionStatusMock.mockResolvedValue(
			createSessionStatus({
				latest_attempt: {
					completed_at: "2099-01-01T00:00:00.000Z",
					failure_code: "selfie_face_mismatch",
					handoff_claimed: true,
					id: "va_attempt123",
					retry_allowed: true,
					status: "failed",
				},
				same_device_only: true,
				status: "created",
			}),
		);

		const view = render(<Handoff />);

		await flushUi();

		act(() => {
			view.getByRole("button", { name: "Close this page" }).click();
		});

		expect(closeSpy).toHaveBeenCalledTimes(1);
		expect(view.queryByTestId("cancel-dialog")).toBeNull();
		expect(requestCancelVerifySessionMock).not.toHaveBeenCalled();
	});

	test("dismisses the cancel dialog without cancelling the session", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "ios",
		});

		requestHandoffPayloadMock.mockResolvedValue(createHandoffPayload());
		requestVerifySessionStatusMock.mockResolvedValue(createSessionStatus());

		const view = render(<Handoff />);

		await flushUi();

		act(() => {
			view.getByRole("button", { name: "Cancel" }).click();
		});
		await flushUi();

		expect(view.getByTestId("cancel-dialog")).not.toBeNull();

		act(() => {
			view
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.cancelDialog.dismiss })
				.click();
		});
		await flushUi();

		expect(view.queryByTestId("cancel-dialog")).toBeNull();
		expect(requestCancelVerifySessionMock).not.toHaveBeenCalled();
		expect(view.getByTestId("qr-code")).not.toBeNull();
	});

	test("redirects after a terminal session status and appends session_id", async () => {
		vi.useFakeTimers();

		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});

		requestHandoffPayloadMock.mockRejectedValue(
			createVerifyRequestError(
				"SESSION_EXPIRED",
				"The verification session has already finished.",
			),
		);
		requestVerifySessionStatusMock.mockResolvedValue(
			createSessionStatus({
				completed_at: "2099-01-01T00:00:00.000Z",
				is_terminal: true,
				latest_attempt: {
					completed_at: "2099-01-01T00:00:00.000Z",
					failure_code: null,
					handoff_claimed: true,
					id: "va_attempt123",
					retry_allowed: false,
					status: "succeeded",
				},
				redirect_url: "https://example.com/return?foo=bar",
				same_device_only: true,
				status: "completed",
			}),
		);

		const view = render(<Handoff />);

		await flushUi();
		expect(
			view.getByText(
				VERIFY_HANDOFF_COPY.screens.terminal.redirectHeaderDescription,
			),
		).not.toBeNull();
		expect(
			view.getByText(VERIFY_HANDOFF_COPY.actions.continueNow),
		).not.toBeNull();
		expect(view.getByText(REDIRECT_COUNTDOWN_TEXT)).not.toBeNull();
		expect(view.queryByTestId("qr-code")).toBeNull();

		act(() => {
			vi.advanceTimersByTime(3000);
		});
		await flushUi();

		expect(assignLocationSpy).toHaveBeenCalledWith(
			"https://example.com/return?foo=bar&session_id=vs_session123",
		);
	});

	test("shows terminal failure state without redirect when redirect_url is absent", async () => {
		mockedUseDevice.mockReturnValue({
			supported: false,
			os: "unknown",
		});

		requestHandoffPayloadMock.mockRejectedValue(
			createVerifyRequestError(
				"SESSION_EXPIRED",
				"The verification session has already finished.",
			),
		);
		requestVerifySessionStatusMock.mockResolvedValue(
			createSessionStatus({
				completed_at: "2099-01-01T00:00:00.000Z",
				is_terminal: true,
				latest_attempt: {
					completed_at: "2099-01-01T00:00:00.000Z",
					failure_code: "selfie_face_mismatch",
					handoff_claimed: true,
					id: "va_attempt123",
					retry_allowed: false,
					status: "failed",
				},
				redirect_url: null,
				same_device_only: true,
				status: "completed",
			}),
		);

		const view = render(<Handoff />);

		expect(
			await view.findByText(SELFIE_FAILURE_CLOSE_PAGE_TEXT),
		).not.toBeNull();
		expect(view.getByText(SELFIE_FAILURE_CLOSE_PAGE_TEXT)).not.toBeNull();
		expect(assignLocationSpy).not.toHaveBeenCalled();
		expect(view.queryByTestId("qr-code")).toBeNull();
	});
});
