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
	goToUnverifiedOrgWarning: () => set({ step: "unverified_org_warning" }),
	goToExplain: () => set({ step: "explain" }),
	goToConsent: () => set({ step: "consent" }),
	goToHandoff: () => set({ step: "handoff" }),
	goToResult: () => set({ step: "result" }),
	goToTeardown: () => set({ step: "teardown" }),
}));
