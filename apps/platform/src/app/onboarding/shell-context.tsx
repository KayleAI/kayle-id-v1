import { createContext, useContext } from "react";
import type { FullOrganization } from "@/app/organizations/api";
import type { BusinessDetailsDraftValues } from "@/app/organizations/business";
import type { ComplianceDraftValues } from "@/app/organizations/compliance";
import type { PublicDetailsDraftValues } from "@/app/organizations/public-details";

/**
 * The five wizard steps, in order. Slugs are URL-safe (hyphenated for the
 * owner-ID step). The intro is its own step with no associated form — it just
 * welcomes the user before they start filling things in.
 */
export const ONBOARDING_STEP_ORDER = [
	"intro",
	"public",
	"business",
	"compliance",
	"owner-id",
] as const;

export type OnboardingRouteStep = (typeof ONBOARDING_STEP_ORDER)[number];

export const ONBOARDING_STEP_HEADER_LABELS: Record<
	OnboardingRouteStep,
	string
> = {
	intro: "Welcome",
	public: "Public Details",
	business: "Business Details",
	compliance: "Compliance Details",
	"owner-id": "Owner ID Check",
};

/**
 * Context shared between the layout (`OnboardingPage`) and each child route.
 * The layout owns organization data + draft state + the advance handler;
 * each step reads what it needs via `useOnboardingContext`.
 */
export interface OnboardingOutletContext {
	canAcceptRpTerms: boolean;
	canEdit: boolean;
	isOwner: boolean;
	organization: FullOrganization;
	setBusinessDraft: (values: BusinessDetailsDraftValues) => void;
	setComplianceDraft: (values: ComplianceDraftValues) => void;
	setPublicDraft: (values: PublicDetailsDraftValues) => void;
	advanceToNextStep: () => void;
}

const OnboardingContext = createContext<OnboardingOutletContext | null>(null);

export function OnboardingProvider({
	children,
	value,
}: {
	children: React.ReactNode;
	value: OnboardingOutletContext;
}) {
	return (
		<OnboardingContext.Provider value={value}>
			{children}
		</OnboardingContext.Provider>
	);
}

export function useOnboardingContext(): OnboardingOutletContext {
	const value = useContext(OnboardingContext);
	if (!value) {
		throw new Error(
			"useOnboardingContext must be called inside <OnboardingProvider>",
		);
	}
	return value;
}

/**
 * Map of URL → step. The bare `/onboarding` path is the intro itself —
 * we don't redirect to `/onboarding/intro`. Returns `"intro"` for any
 * unrecognized child route too, so the layout doesn't break on typos.
 */
export function stepFromPathname(pathname: string): OnboardingRouteStep {
	const trimmed = pathname.replace(/\/$/, "");
	if (trimmed === "/onboarding") {
		return "intro";
	}
	for (const slug of ONBOARDING_STEP_ORDER) {
		if (slug === "intro") {
			continue;
		}
		if (
			trimmed === `/onboarding/${slug}` ||
			trimmed.startsWith(`/onboarding/${slug}/`)
		) {
			return slug;
		}
	}
	return "intro";
}

/** Inverse of `stepFromPathname` — used by the layout's nav handlers. */
export function pathForStep(step: OnboardingRouteStep): string {
	return step === "intro" ? "/onboarding" : `/onboarding/${step}`;
}
