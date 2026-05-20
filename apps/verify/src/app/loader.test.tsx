/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useVerificationStore } from "../stores/session";

const mockedUseDevice = vi.fn();
const mockedUseSession = vi.fn();

vi.mock("@/hooks/use-device", () => ({
	useDevice: () => mockedUseDevice(),
}));

vi.mock("./session-provider", () => ({
	useSession: () => mockedUseSession(),
}));

vi.mock("@kayle-id/ui/components/spinner", () => ({
	Spinner: () => <div data-testid="session-loader-spinner" />,
}));

import { SessionLoader } from "./loader";

beforeEach(() => {
	mockedUseDevice.mockReset();
	mockedUseSession.mockReset();
	mockedUseDevice.mockReturnValue({
		os: "ios",
		supported: true,
	});
	mockedUseSession.mockReturnValue({
		error: null,
		isSessionDetailsReady: true,
		onError: vi.fn(),
		session: null,
	});
	useVerificationStore.setState({ step: "explain" });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("SessionLoader", () => {
	test("does not render during session-independent intro steps", () => {
		render(<SessionLoader />);

		expect(screen.queryByTestId("session-loader-spinner")).toBeNull();
	});

	test("renders while session details are still loading", () => {
		mockedUseSession.mockReturnValue({
			error: null,
			isSessionDetailsReady: false,
			onError: vi.fn(),
			session: null,
		});

		render(<SessionLoader />);

		expect(screen.getByTestId("session-loader-spinner")).not.toBeNull();
	});

	test("renders while a session-dependent step waits for bootstrap", () => {
		useVerificationStore.setState({ step: "result" });

		render(<SessionLoader />);

		expect(screen.getByTestId("session-loader-spinner")).not.toBeNull();
	});

	test("does not render for the browser handoff flow", () => {
		mockedUseDevice.mockReturnValue({
			os: "unknown",
			supported: false,
		});
		useVerificationStore.setState({ step: "result" });

		render(<SessionLoader />);

		expect(screen.queryByTestId("session-loader-spinner")).toBeNull();
	});
});
