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
import type * as React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SignIn } from "./sign-in";

interface MockButtonProps extends React.ComponentProps<"button"> {
	nativeButton?: boolean;
	render?: React.ReactNode;
	variant?: string;
}

const mocks = vi.hoisted(() => ({
	magicSignIn: vi.fn(),
	navigate: vi.fn(),
	passkeySignIn: vi.fn(),
	socialSignIn: vi.fn(),
}));

vi.mock("@kayle-id/auth/client", () => ({
	client: {
		magic: {
			signIn: mocks.magicSignIn,
		},
		signIn: {
			passkey: mocks.passkeySignIn,
			social: mocks.socialSignIn,
		},
	},
}));

vi.mock("@kayle-id/ui/components/button", async () => {
	const React = await import("react");

	return {
		Button: ({ children, render, ...props }: MockButtonProps) => {
			if (React.isValidElement(render)) {
				return render;
			}

			return (
				<button
					className={props.className}
					disabled={props.disabled}
					onClick={props.onClick}
					type={props.type}
				>
					{children}
				</button>
			);
		},
	};
});

vi.mock("@kayle-id/ui/components/input", () => ({
	Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@kayle-id/ui/components/logo", () => ({
	Logo: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
}));

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	mocks.magicSignIn.mockReset();
	mocks.navigate.mockReset();
	mocks.passkeySignIn.mockReset();
	mocks.socialSignIn.mockReset();
});

test("does not start passkey sign-in on page load", () => {
	render(<SignIn />);

	expect(mocks.passkeySignIn).not.toHaveBeenCalled();
});

test("shows passkey-specific button state while passkey sign-in is pending", () => {
	mocks.passkeySignIn.mockReturnValue(new Promise(() => undefined));

	render(<SignIn />);

	fireEvent.click(screen.getByRole("button", { name: "Sign in with passkey" }));

	expect(screen.queryByRole("status")).toBeNull();
	expect(
		(
			screen.getByRole("button", {
				name: "Waiting for passkey...",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(
		(
			screen.getByRole("button", {
				name: "Send sign-in link",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

test("shows passkey failures returned by the auth client", async () => {
	mocks.passkeySignIn.mockResolvedValue({
		data: null,
		error: {
			code: "AUTH_CANCELLED",
			message: "Authentication cancelled",
			status: 400,
			statusText: "BAD_REQUEST",
		},
	});

	render(<SignIn />);

	fireEvent.click(screen.getByRole("button", { name: "Sign in with passkey" }));

	await waitFor(() => {
		expect(screen.getByRole("alert").textContent).toContain(
			"Passkey sign-in was canceled.",
		);
	});
});
