import { createContext, useContext } from "react";
import type { FullOrganization } from "@/app/organizations/api";
import type { BusinessDetailsDraftValues } from "@/app/organizations/business";
import type { ComplianceDraftValues } from "@/app/organizations/compliance";
import type { PublicDetailsDraftValues } from "@/app/organizations/public-details";

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

// `/onboarding` itself is the intro — falls back to "intro" for unknown subroutes.
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

export function pathForStep(step: OnboardingRouteStep): string {
	return step === "intro" ? "/onboarding" : `/onboarding/${step}`;
}
