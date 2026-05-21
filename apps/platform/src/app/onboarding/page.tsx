import { useAuth } from "@kayle-id/auth/client/provider";
import { getOrganizationComplianceProfileStatus } from "@kayle-id/auth/organization-metadata";
import {
	getOrganizationBusinessDetailsStatus,
	getOrganizationPublicDetailsStatus,
} from "@kayle-id/auth/organization-onboarding";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";
import { Button } from "@kayle-id/ui/components/button";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import type { BusinessDetailsDraftValues } from "@/app/organizations/business";
import type { ComplianceDraftValues } from "@/app/organizations/compliance";
import type { PublicDetailsDraftValues } from "@/app/organizations/public-details";
import { useCurrentMemberRole } from "@/app/organizations/use-organization-query";
import { OnboardingPreviewPane } from "./preview-pane";
import {
	ONBOARDING_STEP_HEADER_LABELS,
	ONBOARDING_STEP_ORDER,
	type OnboardingOutletContext,
	OnboardingProvider,
	type OnboardingRouteStep,
	pathForStep,
	stepFromPathname,
} from "./shell-context";
import { useOnboardingStatus } from "./use-onboarding-status";

// Layout shell for /onboarding/*. Owns the org query, the live form draft
// state, and the Continue/Back navigation. Each child route at
// /onboarding/<slug> renders its own step body via `<Outlet />`.
export function OnboardingPage() {
	const { activeOrganization } = useAuth();
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const activeStep = stepFromPathname(pathname);
	const { isError, isLoading, organization, rpTermsAccepted } =
		useOnboardingStatus();
	const currentRole = useCurrentMemberRole();
	const isOwner = currentRole === "owner";
	const canEdit = isOwner || currentRole === "admin";

	// Live draft values that drive the left-pane preview. Two write sources:
	//
	// 1. This effect seeds them from the persisted organization as soon as
	//    the org query resolves — so the preview shows real data on /intro
	//    (and any other step the user hasn't mounted yet) without waiting
	//    for the corresponding form to mount.
	// 2. Each form publishes its current values via `onValuesChange` while
	//    the user is on that step — so the preview updates live as the user
	//    types. The form-driven writes always come after the user navigates
	//    to a step, so they correctly take precedence over the seeded values.
	const [publicDraft, setPublicDraft] = useState<PublicDetailsDraftValues>(
		() => ({
			name: organization?.name ?? "",
			description: organization?.metadata?.description ?? "",
			website: organization?.metadata?.website ?? "",
			privacyPolicyUrl: organization?.metadata?.privacyPolicyUrl ?? "",
			termsOfServiceUrl: organization?.metadata?.termsOfServiceUrl ?? "",
			logoPreview: organization?.logo ?? null,
		}),
	);
	const [businessDraft, setBusinessDraft] =
		useState<BusinessDetailsDraftValues>(() => ({
			businessType: organization?.businessType ?? "business",
			businessName: organization?.businessName ?? "",
			businessJurisdiction: organization?.businessJurisdiction ?? "",
			businessRegistrationNumber:
				organization?.businessRegistrationNumber ?? "",
		}));
	const [complianceDraft, setComplianceDraft] = useState<ComplianceDraftValues>(
		() => ({
			legalControllerName: organization?.metadata?.legalControllerName ?? "",
			controllerJurisdiction:
				organization?.metadata?.controllerJurisdiction ?? "",
			supportEmail: organization?.metadata?.supportEmail ?? "",
			fallbackIdvUrl: organization?.metadata?.fallbackIdvUrl ?? "",
			appealUrl: organization?.metadata?.appealUrl ?? "",
			complaintsUrl: organization?.metadata?.complaintsUrl ?? "",
			article6Basis: organization?.metadata?.article6Basis ?? "",
			article9Condition: organization?.metadata?.article9Condition ?? "",
			usesKayleForConsequentialDecisions:
				organization?.metadata?.usesKayleForConsequentialDecisions ?? null,
		}),
	);

	useEffect(() => {
		if (!organization) {
			return;
		}
		setPublicDraft({
			name: organization.name,
			description: organization.metadata?.description ?? "",
			website: organization.metadata?.website ?? "",
			privacyPolicyUrl: organization.metadata?.privacyPolicyUrl ?? "",
			termsOfServiceUrl: organization.metadata?.termsOfServiceUrl ?? "",
			logoPreview: organization.logo ?? null,
		});
	}, [
		organization,
		organization?.name,
		organization?.logo,
		organization?.metadata?.description,
		organization?.metadata?.website,
		organization?.metadata?.privacyPolicyUrl,
		organization?.metadata?.termsOfServiceUrl,
	]);

	useEffect(() => {
		if (!organization) {
			return;
		}
		setBusinessDraft({
			businessType: organization.businessType ?? "business",
			businessName: organization.businessName ?? "",
			businessJurisdiction: organization.businessJurisdiction ?? "",
			businessRegistrationNumber: organization.businessRegistrationNumber ?? "",
		});
	}, [
		organization,
		organization?.businessType,
		organization?.businessName,
		organization?.businessJurisdiction,
		organization?.businessRegistrationNumber,
	]);

	useEffect(() => {
		if (!organization) {
			return;
		}
		setComplianceDraft({
			legalControllerName: organization.metadata?.legalControllerName ?? "",
			controllerJurisdiction:
				organization.metadata?.controllerJurisdiction ?? "",
			supportEmail: organization.metadata?.supportEmail ?? "",
			fallbackIdvUrl: organization.metadata?.fallbackIdvUrl ?? "",
			appealUrl: organization.metadata?.appealUrl ?? "",
			complaintsUrl: organization.metadata?.complaintsUrl ?? "",
			article6Basis: organization.metadata?.article6Basis ?? "",
			article9Condition: organization.metadata?.article9Condition ?? "",
			usesKayleForConsequentialDecisions:
				organization.metadata?.usesKayleForConsequentialDecisions ?? null,
		});
	}, [
		organization,
		organization?.metadata?.legalControllerName,
		organization?.metadata?.controllerJurisdiction,
		organization?.metadata?.supportEmail,
		organization?.metadata?.fallbackIdvUrl,
		organization?.metadata?.appealUrl,
		organization?.metadata?.complaintsUrl,
		organization?.metadata?.article6Basis,
		organization?.metadata?.article9Condition,
		organization?.metadata?.usesKayleForConsequentialDecisions,
	]);

	const activeStepIndex = ONBOARDING_STEP_ORDER.indexOf(activeStep);
	const isFirstStep = activeStepIndex <= 0;
	const isLastStep = activeStepIndex === ONBOARDING_STEP_ORDER.length - 1;

	const advanceToNextStep = (): void => {
		if (activeStepIndex === -1 || isLastStep) {
			navigate({ to: "/dashboard" });
			return;
		}
		const next = ONBOARDING_STEP_ORDER[activeStepIndex + 1];
		if (next) {
			navigate({ to: pathForStep(next) });
		}
	};

	const goBackToPreviousStep = (): void => {
		if (isFirstStep) {
			return;
		}
		const previous = ONBOARDING_STEP_ORDER[activeStepIndex - 1];
		if (previous) {
			navigate({ to: pathForStep(previous) });
		}
	};

	if (isLoading) {
		return (
			<OnboardingTwoPaneShell>
				<OnboardingBody>
					<Skeleton className="h-8 w-64" />
					<div className="mt-8 space-y-4">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-48 w-full" />
					</div>
				</OnboardingBody>
			</OnboardingTwoPaneShell>
		);
	}

	if (isError || !organization || !activeOrganization) {
		return (
			<OnboardingTwoPaneShell>
				<OnboardingBody>
					<Alert variant="destructive">
						<AlertTitle>Failed to load onboarding status</AlertTitle>
						<AlertDescription>
							Something went wrong while loading your organization. Try
							refreshing.
						</AlertDescription>
					</Alert>
				</OnboardingBody>
			</OnboardingTwoPaneShell>
		);
	}

	const outletContext: OnboardingOutletContext = {
		canAcceptRpTerms: isOwner,
		canEdit,
		isOwner,
		organization,
		setBusinessDraft,
		setComplianceDraft,
		setPublicDraft,
		advanceToNextStep,
	};

	const headerLabel = ONBOARDING_STEP_HEADER_LABELS[activeStep];

	// Continue button is always a plain button. When the active step is a
	// form step we programmatically submit `#onboarding-form` via the DOM's
	// `requestSubmit()` so the form's existing onSubmit + onSaved chain
	// drives advancement. Using `form="…" type="submit"` for this was buggy:
	// React reconciles the conditional <Button> at the same JSX position, so
	// after navigation the underlying DOM button briefly retained the new
	// form-submit attributes while the click event was still being
	// processed, causing the next form to auto-submit and skip a step.
	//
	// The owner-id step is a form step *only* while the owner hasn't
	// completed the identity check yet — submitting it kicks off the
	// verification redirect. Once `verifiedAt` is set, Continue just
	// navigates to the dashboard like before.
	const isOwnerIdAwaitingVerification =
		activeStep === "owner-id" && organization.verifiedAt === null;
	const isFormStep =
		activeStep === "public" ||
		activeStep === "business" ||
		activeStep === "compliance" ||
		isOwnerIdAwaitingVerification;

	const handleContinueClick = (): void => {
		if (isFormStep) {
			const form = document.getElementById(
				"onboarding-form",
			) as HTMLFormElement | null;
			if (form) {
				form.requestSubmit();
				return;
			}
		}
		advanceToNextStep();
	};

	const continueLabel = isOwnerIdAwaitingVerification
		? "Accept and continue"
		: isLastStep
			? "Go to dashboard"
			: "Continue";

	// Continue stays disabled until the current step's required fields are
	// filled. Drafts feed this so the button reacts as the user types — without
	// waiting for a save. Skip remains as the explicit bypass.
	const isContinueDisabled = ((): boolean => {
		if (activeStep === "intro") {
			return false;
		}
		if (activeStep === "public") {
			if (!publicDraft.name.trim()) {
				return true;
			}
			return !getOrganizationPublicDetailsStatus({
				logo: publicDraft.logoPreview,
				metadata: {
					description: publicDraft.description,
					website: publicDraft.website,
					privacyPolicyUrl: publicDraft.privacyPolicyUrl,
					termsOfServiceUrl: publicDraft.termsOfServiceUrl,
				},
			}).complete;
		}
		if (activeStep === "business") {
			return !getOrganizationBusinessDetailsStatus(businessDraft).complete;
		}
		if (activeStep === "compliance") {
			const complianceComplete = getOrganizationComplianceProfileStatus({
				legalControllerName: complianceDraft.legalControllerName,
				controllerJurisdiction: complianceDraft.controllerJurisdiction,
				supportEmail: complianceDraft.supportEmail,
				fallbackIdvUrl: complianceDraft.fallbackIdvUrl || null,
				appealUrl: complianceDraft.appealUrl || null,
				complaintsUrl: complianceDraft.complaintsUrl || null,
				article6Basis: complianceDraft.article6Basis,
				article9Condition: complianceDraft.article9Condition,
				// `privacyPolicyUrl` is on the public-details step but the
				// compliance predicate also requires it — pull it from
				// `publicDraft` so a user who's already filled it in earlier in
				// the wizard isn't blocked here.
				privacyPolicyUrl: publicDraft.privacyPolicyUrl,
				usesKayleForConsequentialDecisions:
					complianceDraft.usesKayleForConsequentialDecisions,
			}).complete;
			return !(complianceComplete && rpTermsAccepted);
		}
		if (activeStep === "owner-id") {
			// Verified — Continue just navigates to the dashboard.
			if (organization.verifiedAt !== null) {
				return false;
			}
			// Not verified — Continue triggers the verification redirect, which
			// only owners can do. Non-owners still have Skip as the bypass.
			return !isOwner;
		}
		return false;
	})();

	return (
		<OnboardingTwoPaneShell
			previewPane={
				<OnboardingPreviewPane
					activeStep={activeStep}
					businessDraft={businessDraft}
					isOwnerIdVerified={organization.verifiedAt !== null}
					publicDraft={publicDraft}
				/>
			}
		>
			<header className="border-border/70 border-b px-6 py-6 lg:px-10">
				<p className="font-medium text-foreground text-sm">
					Onboarding —{" "}
					<span className="text-muted-foreground">{headerLabel}</span>
				</p>
			</header>

			<OnboardingBody>
				{!isOwner ? (
					<Alert className="mb-6">
						<AlertTitle>An owner needs to finish onboarding</AlertTitle>
						<AlertDescription>
							You can use the platform, but {organization.name} can't run
							identity checks until an owner finishes every step below.
						</AlertDescription>
					</Alert>
				) : null}

				<OnboardingProvider value={outletContext}>
					<Outlet />
				</OnboardingProvider>
			</OnboardingBody>

			<footer className="border-border/70 border-t px-6 py-4 lg:px-10">
				<div className="flex items-center justify-between gap-2">
					{isFirstStep ? (
						// Empty span keeps `justify-between` pinning the right
						// button group to the right edge of the footer.
						<span aria-hidden="true" />
					) : (
						<Button
							onClick={goBackToPreviousStep}
							type="button"
							variant="outline"
						>
							Back
						</Button>
					)}
					<div className="flex items-center gap-2">
						{isFirstStep ||
						(activeStep === "owner-id" &&
							organization.verifiedAt !== null) ? null : (
							<Button onClick={advanceToNextStep} type="button" variant="ghost">
								Skip
							</Button>
						)}
						<Button
							disabled={isContinueDisabled}
							onClick={handleContinueClick}
							type="button"
						>
							{continueLabel}
						</Button>
					</div>
				</div>
			</footer>
		</OnboardingTwoPaneShell>
	);
}

function OnboardingTwoPaneShell({
	children,
	previewPane,
}: {
	children: ReactNode;
	previewPane?: ReactNode;
}) {
	// The aside is its own floating card on `lg+`: rounded on all sides,
	// inset from the Layout's page surface, with a solid background + soft
	// shadow so it reads as a distinct surface. The aside itself owns the
	// vertical scroll (`overflow-y-auto`) — when the step body exceeds the
	// card height, the entire card content (header + body + footer)
	// scrolls inside the rounded edges, instead of an inner body region
	// scrolling between fixed bars. `overflow-x-hidden` keeps the rounded
	// corners clipping any incidental horizontal overflow cleanly.
	return (
		<>
			<aside
				className={[
					"flex min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden",
					"lg:my-4 lg:ml-4 lg:w-[480px] xl:w-[560px]",
					"lg:rounded-2xl dark:lg:bg-card lg:ring-1 lg:ring-border dark:lg:ring-0",
				].join(" ")}
			>
				{children}
			</aside>
			<section className="hidden flex-1 lg:block">{previewPane}</section>
		</>
	);
}

function OnboardingBody({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-1 flex-col px-6 py-6 lg:px-10 lg:py-8">
			<div className="mt-auto">{children}</div>
		</div>
	);
}

export type { OnboardingOutletContext, OnboardingRouteStep };
