import { create } from "zustand";

export type VerificationStep =
	| "unverified_org_warning"
	| "explain"
	| "consent"
	| "handoff"
	| "result"
	| "teardown";

const SESSION_OPTIONAL_STEPS = new Set<VerificationStep>([
	"unverified_org_warning",
	"explain",
	"consent",
	"handoff",
]);

export function canRenderWithoutSession(step: VerificationStep): boolean {
	return SESSION_OPTIONAL_STEPS.has(step);
}

type VerificationStore = {
	step: VerificationStep;
	goToUnverifiedOrgWarning: () => void;
	goToExplain: () => void;
	goToConsent: () => void;
	goToHandoff: () => void;
	goToResult: () => void;
	goToTeardown: () => void;
};

export const useVerificationStore = create<VerificationStore>((set) => ({
	step: "explain",
	/**
	 * Warn the user that the organization is not verified before continuing.
	 */
	goToUnverifiedOrgWarning: () => set({ step: "unverified_org_warning" }),
	/**
	 * Explain the verification process.
	 */
	goToExplain: () => set({ step: "explain" }),
	/**
	 * Get the user's consent to complete the verification.
	 */
	goToConsent: () => set({ step: "consent" }),
	/**
	 * Continue the verification in the mobile handoff flow.
	 */
	goToHandoff: () => set({ step: "handoff" }),
	/**
	 * Show the result of the verification.
	 */
	goToResult: () => set({ step: "result" }),
	/**
	 * Teardown the verification session.
	 */
	goToTeardown: () => set({ step: "teardown" }),
}));
