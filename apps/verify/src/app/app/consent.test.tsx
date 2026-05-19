/**
 * @vitest-environment jsdom
 */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	requestCancelVerifySession,
	requestRecordVerifyConsent,
} from "@/config/handoff";
import { useVerificationStore } from "../../stores/session";

vi.mock("@/config/handoff", () => ({
	requestCancelVerifySession: vi.fn().mockResolvedValue(undefined),
	requestRecordVerifyConsent: vi.fn().mockResolvedValue({
		consent_id: "vc_test",
		consented_at: "2026-05-17T12:00:00.000Z",
	}),
}));

vi.mock("@kayleai/ui/button", () => ({
	Button: ({
		children,
		disabled,
		nativeButton = true,
		onClick,
		render,
		type = "button",
		variant: _variant,
	}: {
		children: React.ReactNode;
		disabled?: boolean;
		nativeButton?: boolean;
		onClick?: () => void;
		render?: React.ReactNode;
		type?: "button" | "submit";
		variant?: string;
	}) =>
		nativeButton === false && render ? (
			render
		) : (
			<button disabled={disabled} onClick={onClick} type={type}>
				{children}
			</button>
		),
}));

vi.mock("@kayleai/ui/checkbox", () => ({
	Checkbox: ({
		checked,
		id,
		onCheckedChange,
	}: {
		checked: boolean;
		id: string;
		onCheckedChange: (checked: boolean) => void;
	}) => (
		<input
			checked={checked}
			id={id}
			onChange={(event) => onCheckedChange(event.currentTarget.checked)}
			type="checkbox"
		/>
	),
}));

vi.mock("@kayleai/ui/label", () => ({
	Label: ({
		children,
		htmlFor,
	}: {
		children: React.ReactNode;
		htmlFor: string;
	}) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock("@kayleai/ui/logo", () => ({
	Logo: () => <div>Kayle ID</div>,
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
					<div data-testid="refusal-dialog" role="alertdialog">
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

import { SessionConsent } from "./consent";
import type { Organization } from "./organization-name";

const sessionId =
	"vs_consentbrowser000000000000000000000000000000000000000000000000000000";

function createOrganization(
	overrides: Partial<Organization> = {},
): Organization {
	return {
		id: "00000000-0000-4000-8000-000000000123",
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
		rpFallback: {
			appealUrl: null,
			complaintsUrl: null,
			fallbackIdvUrl: null,
			supportEmail: null,
		},
		...overrides,
	};
}

function renderConsent({
	ageThreshold,
	isAgeOnly,
	onSessionCancelled,
	organization = createOrganization(),
}: {
	ageThreshold?: number | null;
	isAgeOnly?: boolean;
	onSessionCancelled?: () => void;
	organization?: Organization;
} = {}) {
	return render(
		<SessionConsent
			ageThreshold={ageThreshold}
			isAgeOnly={isAgeOnly}
			onSessionCancelled={onSessionCancelled}
			organization={organization}
			sessionId={sessionId}
		/>,
	);
}

beforeEach(() => {
	useVerificationStore.setState({ step: "consent" });
	window.history.pushState({}, "", "/");
	vi.mocked(requestRecordVerifyConsent).mockResolvedValue({
		consent_id: "vc_test",
		consented_at: "2026-05-17T12:00:00.000Z",
	});
	vi.mocked(requestCancelVerifySession).mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("SessionConsent", () => {
	test("advances the browser flow into the handoff step after consent", async () => {
		renderConsent();

		const startButton = screen.getByRole("button", {
			name: "Start verification",
		}) as HTMLButtonElement;
		expect(startButton.disabled).toBe(true);

		const checkboxes = screen.getAllByRole("checkbox");
		expect(checkboxes).toHaveLength(1);
		fireEvent.click(checkboxes[0] as HTMLInputElement);
		expect(startButton.disabled).toBe(false);
		fireEvent.click(startButton);

		await waitFor(() => {
			expect(requestRecordVerifyConsent).toHaveBeenCalledWith(sessionId, {
				biometric_consent: true,
				document_processing_consent: true,
				privacy_notice_acknowledged: true,
				share_claims_consent: true,
				terms_acknowledged: true,
			});
			expect(useVerificationStore.getState().step).toBe("handoff");
		});
	});

	test("renders the organization name in the consent copy", () => {
		renderConsent();

		expect(
			screen.getByRole("button", { name: "Test Organization" }),
		).not.toBeNull();
		expect(screen.queryByText("Platform Name")).toBeNull();
	});

	test("renders the default heading and start label for identity sessions", () => {
		renderConsent();

		expect(
			screen.getByRole("heading", { name: "Your consent is required" }),
		).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "Start verification" }),
		).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
	});

	test("renders concise consent bullets without the requested claim manifest", () => {
		renderConsent();

		expect(
			screen.getByText("I allow Kayle ID to read data from my document"),
		).not.toBeNull();
		expect(screen.queryByText("Details requested")).toBeNull();
		expect(screen.queryByText("Required details")).toBeNull();
		expect(screen.queryByText("Security checks")).toBeNull();
	});

	test("renders the age-only consent copy when isAgeOnly is true", () => {
		renderConsent({
			ageThreshold: 18,
			isAgeOnly: true,
		});

		expect(
			screen.getByRole("heading", { name: "Your consent is required" }),
		).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "Confirm my age" }),
		).not.toBeNull();
		expect(
			screen.getByText("To prove your age, you must agree to the following:"),
		).not.toBeNull();
		expect(screen.getAllByRole("checkbox")).toHaveLength(1);
		expect(screen.getByText(/whether I am over 18 with/)).not.toBeNull();
		expect(screen.queryByText("Age-only result")).toBeNull();
	});

	test("falls back to generic age wording when no age threshold is supplied", () => {
		renderConsent({
			ageThreshold: null,
			isAgeOnly: true,
		});

		expect(
			screen.getByRole("button", { name: "Confirm my age" }),
		).not.toBeNull();
		expect(screen.getAllByRole("checkbox")).toHaveLength(1);
		expect(screen.getByText(/whether I am old enough with/)).not.toBeNull();
	});

	test("confirms before cancelling when the user refuses consent", async () => {
		window.history.pushState({}, "", `/?cancel_token=${"a".repeat(48)}`);
		const onSessionCancelled = vi.fn();
		renderConsent({
			onSessionCancelled,
			organization: createOrganization({
				website: "https://test.example/help",
			}),
		});

		fireEvent.click(screen.getByRole("button", { name: "I do not consent" }));

		const refusalDialog = screen.getByRole("alertdialog");
		expect(refusalDialog).not.toBeNull();
		expect(screen.getByText("Do not consent?")).not.toBeNull();
		expect(
			within(refusalDialog).getByRole("button", {
				name: "Test Organization",
			}),
		).not.toBeNull();
		expect(requestCancelVerifySession).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole("button", { name: "Yes, stop this check" }),
		);

		await waitFor(() => {
			expect(requestCancelVerifySession).toHaveBeenCalledWith(
				sessionId,
				"a".repeat(48),
			);
			expect(onSessionCancelled).toHaveBeenCalledTimes(1);
			expect(useVerificationStore.getState().step).toBe("handoff");
			expect(screen.queryByText("Check stopped")).toBeNull();
		});
	});

	test("dismisses the refusal dialog without cancelling", () => {
		window.history.pushState({}, "", `/?cancel_token=${"a".repeat(48)}`);
		renderConsent();

		fireEvent.click(screen.getByRole("button", { name: "I do not consent" }));
		fireEvent.click(screen.getByRole("button", { name: "Go back" }));

		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(requestCancelVerifySession).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Start verification" }),
		).not.toBeNull();
	});
});
