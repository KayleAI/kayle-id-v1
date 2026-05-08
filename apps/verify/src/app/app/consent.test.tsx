/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useVerificationStore } from "../../stores/session";

vi.mock("@kayleai/ui/button", () => ({
	Button: ({
		children,
		disabled,
		nativeButton = true,
		onClick,
		render,
		type = "button",
	}: {
		children: React.ReactNode;
		disabled?: boolean;
		nativeButton?: boolean;
		onClick?: () => void;
		render?: React.ReactNode;
		type?: "button" | "submit";
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

import { SessionConsent } from "./consent";

beforeEach(() => {
	useVerificationStore.setState({ step: "consent" });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("SessionConsent", () => {
	test("advances the browser flow into the handoff step after consent", () => {
		render(<SessionConsent />);

		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.click(screen.getByRole("button", { name: "Start verification" }));

		expect(useVerificationStore.getState().step).toBe("handoff");
	});

	test("renders the organization name in the consent copy", () => {
		render(<SessionConsent organizationName="Test Organization" />);

		expect(screen.getByText("Test Organization")).not.toBeNull();
		expect(screen.queryByText("Platform Name")).toBeNull();
	});

	test("renders the default heading and start label for identity sessions", () => {
		render(<SessionConsent organizationName="Test Organization" />);

		expect(
			screen.getByRole("heading", { name: "Your consent is required" }),
		).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "Start verification" }),
		).not.toBeNull();
	});

	test("renders the age-only consent copy when isAgeOnly is true", () => {
		render(
			<SessionConsent
				ageThreshold={18}
				isAgeOnly
				organizationName="Test Organization"
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Your consent is required" }),
		).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "Confirm my age" }),
		).not.toBeNull();
		expect(screen.getByText(/check my age/i)).not.toBeNull();
		expect(screen.getByText(/whether I am over 18/i)).not.toBeNull();
	});

	test("falls back to generic age wording when no age threshold is supplied", () => {
		render(
			<SessionConsent
				ageThreshold={null}
				isAgeOnly
				organizationName="Test Organization"
			/>,
		);

		expect(screen.getByText(/whether I am old enough/i)).not.toBeNull();
	});
});
