import { expect, test, vi } from "vitest";
import { buildOwnerVerificationRedirectUrl } from "./start-org-verification";

vi.mock("@/config/env", () => ({
	env: {},
}));

test("buildOwnerVerificationRedirectUrl returns to onboarding owner ID step", () => {
	expect(buildOwnerVerificationRedirectUrl("https://platform.example")).toBe(
		"https://platform.example/onboarding/owner-id",
	);
});
