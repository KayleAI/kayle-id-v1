/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
	VerifySessionDetailsPayload,
	VerifySessionStatusPayload,
} from "@/config/handoff";
import { useVerificationStore } from "../stores/session";
import { SessionProvider, useSession } from "./session-provider";

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

const sessionId =
	"vs_phase3provider0000000000000000000000000000000000000000000000000000000000";

function createSessionStatus(
	overrides: Partial<VerifySessionStatusPayload> = {},
): VerifySessionStatusPayload {
	return {
		completed_at: null,
		is_terminal: false,
		latest_attempt: null,
		redirect_url: null,
		session_id: sessionId,
		same_device_only: false,
		status: "created",
		...overrides,
	};
}

function setNavigator({
	userAgent,
	platform = "iPhone",
	maxTouchPoints = 5,
}: {
	userAgent: string;
	platform?: string;
	maxTouchPoints?: number;
}) {
	Object.defineProperty(window.navigator, "userAgent", {
		configurable: true,
		value: userAgent,
	});
	Object.defineProperty(window.navigator, "platform", {
		configurable: true,
		value: platform,
	});
	Object.defineProperty(window.navigator, "maxTouchPoints", {
		configurable: true,
		value: maxTouchPoints,
	});
}

function SessionStateProbe() {
	const {
		error,
		isSessionDetailsReady,
		organization,
		sessionStatus,
		session,
		shareFields,
	} = useSession();

	return (
		<div>
			<div data-testid="details-ready">
				{isSessionDetailsReady ? "ready" : "loading"}
			</div>
			<div data-testid="organization-name">{organization.name ?? "none"}</div>
			<div data-testid="session-status">{sessionStatus?.status ?? "none"}</div>
			<div data-testid="session-state">{session ? "ready" : "idle"}</div>
			<div data-testid="session-error">{error?.code ?? "none"}</div>
			<div data-testid="share-field-count">
				{Object.keys(shareFields).length}
			</div>
		</div>
	);
}

function createSessionDetails(
	overrides: Partial<VerifySessionDetailsPayload> = {},
): VerifySessionDetailsPayload {
	return {
		organization_id: "00000000-0000-4000-8000-000000000123",
		organization_name: "Test Organization",
		organization_owner_id_check_completed: true,
		organization_verified_apex_domains: ["test.example"],
		organization_logo: null,
		organization_business_type: null,
		organization_business_name: null,
		organization_business_jurisdiction: null,
		organization_business_registration_number: null,
		organization_privacy_policy_url: null,
		organization_terms_of_service_url: null,
		organization_website: null,
		organization_description: null,
		rp_fallback: {
			appeal_url: null,
			complaints_url: null,
			fallback_idv_url: null,
			support_email: null,
		},
		is_age_only: false,
		age_threshold: null,
		share_fields: {
			kayle_document_id: {
				required: true,
				reason: "Document ID is required.",
				source: "default",
			},
		},
		session_id: sessionId,
		...overrides,
	};
}

function renderProvider() {
	return render(
		<SessionProvider sessionId={sessionId}>
			<SessionStateProbe />
		</SessionProvider>,
	);
}

function createMemoryStorage(): Storage {
	const values = new Map<string, string>();

	return {
		get length() {
			return values.size;
		},
		clear: () => {
			values.clear();
		},
		getItem: (key) => values.get(key) ?? null,
		key: (index) => Array.from(values.keys())[index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

function getTestLocalStorage(): Storage {
	const storage = window.localStorage;

	if (
		typeof storage.clear === "function" &&
		typeof storage.getItem === "function" &&
		typeof storage.removeItem === "function" &&
		typeof storage.setItem === "function"
	) {
		return storage;
	}

	const memoryStorage = createMemoryStorage();

	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: memoryStorage,
	});

	return memoryStorage;
}

beforeEach(() => {
	getTestLocalStorage().clear();
	useVerificationStore.setState({ step: "explain" });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("SessionProvider", () => {
	test("does not bootstrap websocket for the browser handoff flow", async () => {
		setNavigator({
			userAgent:
				"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
			platform: "Linux armv8l",
			maxTouchPoints: 0,
		});

		const handoffModule = await import("@/config/handoff");
		const capnpModule = await import("@/config/capnp");
		const handoffSpy = vi.spyOn(handoffModule, "requestHandoffPayload");
		const detailsSpy = vi
			.spyOn(handoffModule, "requestVerifySessionDetails")
			.mockResolvedValue(createSessionDetails());
		const statusSpy = vi
			.spyOn(handoffModule, "requestVerifySessionStatus")
			.mockResolvedValue(createSessionStatus());
		const initialiseSpy = vi.spyOn(capnpModule, "initialiseSession");

		const view = renderProvider();

		await waitFor(() => {
			expect(view.getByTestId("session-state").textContent).toBe("idle");
		});

		expect(handoffSpy).not.toHaveBeenCalled();
		expect(detailsSpy).toHaveBeenCalledWith(sessionId);
		expect(statusSpy).toHaveBeenCalledWith(sessionId);
		expect(initialiseSpy).not.toHaveBeenCalled();
	});

	test("does not bootstrap websocket on the iPhone handoff flow", async () => {
		setNavigator({
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		});

		const handoffModule = await import("@/config/handoff");
		const capnpModule = await import("@/config/capnp");
		const handoffSpy = vi.spyOn(handoffModule, "requestHandoffPayload");
		const detailsSpy = vi
			.spyOn(handoffModule, "requestVerifySessionDetails")
			.mockResolvedValue(createSessionDetails());
		const statusSpy = vi
			.spyOn(handoffModule, "requestVerifySessionStatus")
			.mockResolvedValue(createSessionStatus());
		const initialiseSpy = vi.spyOn(capnpModule, "initialiseSession");

		const view = renderProvider();

		await waitFor(() => {
			expect(view.getByTestId("session-state").textContent).toBe("idle");
		});

		expect(handoffSpy).not.toHaveBeenCalled();
		expect(detailsSpy).toHaveBeenCalledWith(sessionId);
		expect(statusSpy).toHaveBeenCalledWith(sessionId);
		expect(initialiseSpy).not.toHaveBeenCalled();
	});

	test("does not surface websocket bootstrap errors on the iPhone handoff flow", async () => {
		setNavigator({
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		});

		const handoffModule = await import("@/config/handoff");
		const capnpModule = await import("@/config/capnp");
		const handoffSpy = vi.spyOn(handoffModule, "requestHandoffPayload");
		const detailsSpy = vi
			.spyOn(handoffModule, "requestVerifySessionDetails")
			.mockResolvedValue(createSessionDetails());
		const statusSpy = vi
			.spyOn(handoffModule, "requestVerifySessionStatus")
			.mockResolvedValue(createSessionStatus());
		const initialiseSpy = vi.spyOn(capnpModule, "initialiseSession");

		const view = renderProvider();

		await waitFor(() => {
			expect(view.getByTestId("session-error").textContent).toBe("none");
		});

		expect(handoffSpy).not.toHaveBeenCalled();
		expect(detailsSpy).toHaveBeenCalledWith(sessionId);
		expect(statusSpy).toHaveBeenCalledWith(sessionId);
		expect(initialiseSpy).not.toHaveBeenCalled();
	});

	test("exposes the organization name when session details load", async () => {
		setNavigator({
			userAgent:
				"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
			platform: "Linux armv8l",
			maxTouchPoints: 0,
		});

		const handoffModule = await import("@/config/handoff");
		vi.spyOn(handoffModule, "requestVerifySessionDetails").mockResolvedValue(
			createSessionDetails(),
		);
		vi.spyOn(handoffModule, "requestVerifySessionStatus").mockResolvedValue(
			createSessionStatus(),
		);

		const view = renderProvider();

		await waitFor(() => {
			expect(view.getByTestId("organization-name").textContent).toBe(
				"Test Organization",
			);
		});
	});

	test("surfaces session errors when organization details fail to load", async () => {
		setNavigator({
			userAgent:
				"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
			platform: "Linux armv8l",
			maxTouchPoints: 0,
		});

		const handoffModule = await import("@/config/handoff");
		vi.spyOn(handoffModule, "requestVerifySessionDetails").mockRejectedValue(
			Object.assign(new Error("Session not found."), {
				code: "SESSION_NOT_FOUND",
			}),
		);
		vi.spyOn(handoffModule, "requestVerifySessionStatus").mockResolvedValue(
			createSessionStatus(),
		);

		const view = renderProvider();

		await waitFor(() => {
			expect(view.getByTestId("details-ready").textContent).toBe("ready");
			expect(view.getByTestId("session-error").textContent).toBe(
				"SESSION_NOT_FOUND",
			);
		});
	});

	test("routes revisits with an existing attempt directly into handoff", async () => {
		setNavigator({
			userAgent:
				"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
			platform: "Linux armv8l",
			maxTouchPoints: 0,
		});

		const handoffModule = await import("@/config/handoff");
		vi.spyOn(handoffModule, "requestVerifySessionDetails").mockResolvedValue(
			createSessionDetails(),
		);
		vi.spyOn(handoffModule, "requestVerifySessionStatus").mockResolvedValue(
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
			}),
		);

		renderProvider();

		await waitFor(() => {
			expect(useVerificationStore.getState().step).toBe("handoff");
		});
	});
});
