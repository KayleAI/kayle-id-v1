/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

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

import { SessionExplain } from "./explain";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("SessionExplain", () => {
	test("renders the organization name in the share copy", () => {
		render(<SessionExplain organizationName="Test Organization" />);

		expect(screen.getByText("Test Organization")).not.toBeNull();
		expect(screen.queryByText("Platform Name")).toBeNull();
	});

	test("renders the identity-verification heading by default", () => {
		render(<SessionExplain organizationName="Test Organization" />);

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
				organizationName="Test Organization"
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
				organizationName="Test Organization"
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Confirm your age" }),
		).not.toBeNull();
	});
});
