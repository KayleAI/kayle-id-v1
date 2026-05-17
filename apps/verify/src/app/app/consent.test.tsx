/**
 * @vitest-environment jsdom
 */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	requestCancelVerifySession,
	requestRecordVerifyConsent,
	type VerifySessionShareFields,
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

const defaultShareFields: VerifySessionShareFields = {
	family_name: {
		required: true,
		reason: "Name is required.",
		source: "rc",
	},
	kayle_document_id: {
		required: true,
		reason: "Document ID is required.",
		source: "default",
	},
	nationality_code: {
		required: false,
		reason: "Nationality is optional.",
		source: "rc",
	},
};

function renderConsent({
	ageThreshold,
	isAgeOnly,
	organization = createOrganization(),
	shareFields = defaultShareFields,
}: {
	ageThreshold?: number | null;
	isAgeOnly?: boolean;
	organization?: Organization;
	shareFields?: VerifySessionShareFields;
} = {}) {
	return render(
		<SessionConsent
			ageThreshold={ageThreshold}
			isAgeOnly={isAgeOnly}
			organization={organization}
			sessionId={sessionId}
			shareFields={shareFields}
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

		for (const checkbox of screen.getAllByRole("checkbox")) {
			fireEvent.click(checkbox);
		}
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

		expect(screen.getByText("Test Organization")).not.toBeNull();
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
	});

	test("renders the requested claim manifest before handoff", () => {
		renderConsent();

		expect(screen.getByText("Details requested")).not.toBeNull();
		expect(screen.getByText("Required details")).not.toBeNull();
		expect(screen.getByText("Optional details")).not.toBeNull();
		expect(screen.getByText("Security checks")).not.toBeNull();
		expect(screen.getByText("Family Name")).not.toBeNull();
		expect(screen.getByText("Nationality Code")).not.toBeNull();
		expect(screen.getByText("Kayle Document ID")).not.toBeNull();
	});

	test("renders the age-only consent copy when isAgeOnly is true", () => {
		renderConsent({
			ageThreshold: 18,
			isAgeOnly: true,
			shareFields: {
				age_over_18: {
					required: true,
					reason: "Age gate is required.",
					source: "rc",
				},
				kayle_document_id: {
					required: true,
					reason: "Document ID is required.",
					source: "default",
				},
			},
		});

		expect(
			screen.getByRole("heading", { name: "Your consent is required" }),
		).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "Confirm my age" }),
		).not.toBeNull();
		expect(screen.getAllByText(/check my age/i).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/whether I am over 18/i).length).toBeGreaterThan(
			0,
		);
		expect(screen.getByText("Age-only result")).not.toBeNull();
	});

	test("falls back to generic age wording when no age threshold is supplied", () => {
		renderConsent({
			ageThreshold: null,
			isAgeOnly: true,
		});

		expect(
			screen.getAllByText(/whether I am old enough/i).length,
		).toBeGreaterThan(0);
	});

	test("cancels and shows an RP path when the user refuses consent", async () => {
		window.history.pushState({}, "", `/?cancel_token=${"a".repeat(48)}`);
		renderConsent({
			organization: createOrganization({
				website: "https://test.example/help",
			}),
		});

		fireEvent.click(screen.getByRole("button", { name: "I do not consent" }));

		await waitFor(() => {
			expect(requestCancelVerifySession).toHaveBeenCalledWith(
				sessionId,
				"a".repeat(48),
			);
			expect(screen.getByText("Check stopped")).not.toBeNull();
			expect(
				screen.getByRole("link", { name: "Contact Test Organization" }),
			).not.toBeNull();
		});
	});
});
