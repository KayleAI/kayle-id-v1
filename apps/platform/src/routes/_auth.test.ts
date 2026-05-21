import { describe, expect, test } from "vitest";
import { usesAuthFlowShellPath } from "./_auth";

describe("usesAuthFlowShellPath", () => {
	test("uses the onboarding-style shell for every auth flow step", () => {
		expect(usesAuthFlowShellPath("/sign-in")).toBe(true);
		expect(usesAuthFlowShellPath("/verify")).toBe(true);
		expect(usesAuthFlowShellPath("/verify-2fa")).toBe(true);
		expect(usesAuthFlowShellPath("/sign-out")).toBe(true);
		expect(usesAuthFlowShellPath("/select-organization")).toBe(true);
		expect(usesAuthFlowShellPath("/create-organization")).toBe(true);
	});

	test("does not match unrelated routes", () => {
		expect(usesAuthFlowShellPath("/dashboard")).toBe(false);
		expect(usesAuthFlowShellPath("/onboarding")).toBe(false);
	});
});
