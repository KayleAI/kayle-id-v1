/**
 * @vitest-environment jsdom
 */
import { VERIFY_HANDOFF_COPY } from "@kayle-id/translations/verify-handoff-copy";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const markSessionCancelledMock = vi.fn();
const requestCancelVerifySessionMock = vi.fn();
const goToHandoffMock = vi.fn();

vi.mock("@kayleai/ui/button", () => ({
	Button: ({
		children,
		onClick,
		type = "button",
	}: {
		children: React.ReactNode;
		onClick?: () => void;
		type?: "button" | "submit";
	}) => (
		<button onClick={onClick} type={type}>
			{children}
		</button>
	),
}));

vi.mock("@kayleai/ui/logo", () => ({
	Logo: () => <div>Kayle ID</div>,
}));

vi.mock("@kayleai/ui/dialog", () => ({
	Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	DialogTrigger: ({
		children,
		className,
	}: {
		children: React.ReactNode;
		className?: string;
	}) => (
		<button className={className} type="button">
			{children}
		</button>
	),
	DialogContent: () => null,
	DialogHeader: () => null,
	DialogTitle: () => null,
	DialogDescription: () => null,
	DialogFooter: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
	useLoaderData: () => ({
		sessionId: "vs_session123",
	}),
}));

vi.mock("../session-provider", () => ({
	useSession: () => ({
		markSessionCancelled: markSessionCancelledMock,
	}),
}));

vi.mock("@/config/handoff", () => ({
	requestCancelVerifySession: (sessionId: string, cancelToken: string) =>
		requestCancelVerifySessionMock(sessionId, cancelToken),
}));

vi.mock("../../stores/session", () => ({
	useVerificationStore: (selector: (state: unknown) => unknown) =>
		selector({
			goToConsent: () => {},
			goToHandoff: goToHandoffMock,
		}),
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

import { SessionExplain } from "./explain";
import type { Organization } from "./organization-name";

function createOrganization(
	overrides: Partial<Organization> = {},
): Organization {
	return {
		name: "Test Organization",
		ownerIdCheckCompleted: true,
		verifiedApexDomains: ["test.example"],
		logo: null,
		businessType: null,
		businessName: null,
		businessJurisdiction: null,
		businessRegistrationNumber: null,
		privacyPolicyUrl: null,
		termsOfServiceUrl: null,
		website: null,
		description: null,
		...overrides,
	};
}

beforeEach(() => {
	markSessionCancelledMock.mockReset();
	requestCancelVerifySessionMock.mockReset();
	goToHandoffMock.mockReset();
	window.history.replaceState({}, "", "/?cancel_token=ct_cancel_token");
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("SessionExplain", () => {
	test("renders the organization name in the share copy", () => {
		render(<SessionExplain organization={createOrganization()} />);

		expect(screen.getByText("Test Organization")).not.toBeNull();
		expect(screen.queryByText("Platform Name")).toBeNull();
	});

	test("renders the identity-verification heading by default", () => {
		render(<SessionExplain organization={createOrganization()} />);

		expect(
			screen.getByRole("heading", {
				name: "Verify your identity with Kayle ID",
			}),
		).not.toBeNull();
	});

	test("renders age-only copy with the threshold when isAgeOnly is true", () => {
		render(
			<SessionExplain
				ageThreshold={21}
				isAgeOnly
				organization={createOrganization()}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Confirm you're over 21" }),
		).not.toBeNull();
		expect(screen.queryByText(/Verify your identity/i)).toBeNull();
		expect(
			screen.getByText(/Nothing else — not your name, date of birth/i),
		).not.toBeNull();
	});

	test("falls back to a generic age headline when no threshold is supplied", () => {
		render(
			<SessionExplain
				ageThreshold={null}
				isAgeOnly
				organization={createOrganization()}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Confirm your age" }),
		).not.toBeNull();
	});

	test("cancels the session and transitions to handoff when the user confirms cancel", async () => {
		requestCancelVerifySessionMock.mockResolvedValue(undefined);

		render(<SessionExplain organization={createOrganization()} />);

		expect(screen.queryByTestId("cancel-dialog")).toBeNull();

		act(() => {
			screen
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.actions.cancel })
				.click();
		});

		expect(screen.getByTestId("cancel-dialog")).not.toBeNull();
		expect(requestCancelVerifySessionMock).not.toHaveBeenCalled();

		act(() => {
			screen
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.cancelDialog.confirm })
				.click();
		});

		await waitFor(() => {
			expect(requestCancelVerifySessionMock).toHaveBeenCalledWith(
				"vs_session123",
				"ct_cancel_token",
			);
		});
		expect(markSessionCancelledMock).toHaveBeenCalledTimes(1);
		expect(goToHandoffMock).toHaveBeenCalledTimes(1);
		expect(screen.queryByTestId("cancel-dialog")).toBeNull();
	});

	test("dismisses the cancel dialog without cancelling the session", () => {
		render(<SessionExplain organization={createOrganization()} />);

		act(() => {
			screen
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.actions.cancel })
				.click();
		});

		expect(screen.getByTestId("cancel-dialog")).not.toBeNull();

		act(() => {
			screen
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.cancelDialog.dismiss })
				.click();
		});

		expect(screen.queryByTestId("cancel-dialog")).toBeNull();
		expect(requestCancelVerifySessionMock).not.toHaveBeenCalled();
		expect(markSessionCancelledMock).not.toHaveBeenCalled();
		expect(goToHandoffMock).not.toHaveBeenCalled();
	});

	test("shows an error and skips the API call when no cancel token is in the URL", async () => {
		window.history.replaceState({}, "", "/");

		render(<SessionExplain organization={createOrganization()} />);

		act(() => {
			screen
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.actions.cancel })
				.click();
		});
		act(() => {
			screen
				.getByRole("button", { name: VERIFY_HANDOFF_COPY.cancelDialog.confirm })
				.click();
		});

		await waitFor(() => {
			expect(
				screen.getByText(VERIFY_HANDOFF_COPY.handoff.cancelError),
			).not.toBeNull();
		});
		expect(requestCancelVerifySessionMock).not.toHaveBeenCalled();
		expect(markSessionCancelledMock).not.toHaveBeenCalled();
		expect(goToHandoffMock).not.toHaveBeenCalled();
	});
});
