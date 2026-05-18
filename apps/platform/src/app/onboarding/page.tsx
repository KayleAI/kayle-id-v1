import { useAuth } from "@kayle-id/auth/client/provider";
import type { OnboardingStepId } from "@kayle-id/auth/organization-onboarding";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import { Skeleton } from "@kayleai/ui/skeleton";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	acceptVerificationTerms,
	createOwnerVerificationSession,
	type FullOrganization,
	type OrganizationRole,
} from "@/app/organizations/api";
import { BusinessDetailsForm } from "@/app/organizations/business";
import { ComplianceForm } from "@/app/organizations/compliance";
import { PublicDetailsForm } from "@/app/organizations/public-details";
import { useOnboardingStatus } from "./use-onboarding-status";

interface StepDefinition {
	id: OnboardingStepId;
	/** Shown in the "Onboarding - <headerLabel>" indicator at the top of the aside. */
	headerLabel: string;
	completedCopy: string;
}

const STEP_DEFINITIONS: readonly StepDefinition[] = [
	{
		id: "business",
		headerLabel: "Business Details",
		completedCopy: "Business details are on file.",
	},
	{
		id: "public",
		headerLabel: "Public Details",
		completedCopy: "Public details are on file.",
	},
	{
		id: "compliance",
		headerLabel: "Compliance Details",
		completedCopy:
			"Compliance profile is complete and the current Kayle ID Integration Terms are accepted.",
	},
	{
		id: "owner_id",
		headerLabel: "Owner ID Check",
		completedCopy:
			"Owner identity check on file. The organization is verified.",
	},
] as const;

const STEP_ORDER: readonly OnboardingStepId[] = STEP_DEFINITIONS.map(
	(s) => s.id,
);

export function OnboardingPage() {
	const { activeOrganization, user } = useAuth();
	const navigate = useNavigate();
	const { isError, isLoading, organization, steps } = useOnboardingStatus();

	const currentRole = organization?.members.find(
		(member) => member.userId === user?.id,
	)?.role as OrganizationRole | undefined;
	const isOwner = currentRole === "owner";
	const canEdit = isOwner || currentRole === "admin";

	const firstIncompleteStep = useMemo<OnboardingStepId>(() => {
		const incomplete = steps.find((s) => !s.complete);
		return incomplete?.id ?? "business";
	}, [steps]);

	const [activeStepId, setActiveStepId] =
		useState<OnboardingStepId>(firstIncompleteStep);

	// Snap to the next incomplete step once status finishes loading. After
	// that the user can navigate freely (Back / Continue / direct visits) —
	// onboarding is replayable, not a one-shot wizard.
	const [hasInitialised, setHasInitialised] = useState(false);
	useEffect(() => {
		if (!isLoading && !hasInitialised) {
			setActiveStepId(firstIncompleteStep);
			setHasInitialised(true);
		}
	}, [firstIncompleteStep, hasInitialised, isLoading]);

	const activeStepIndex = STEP_ORDER.indexOf(activeStepId);
	const isFirstStep = activeStepIndex <= 0;
	const isLastStep = activeStepIndex === STEP_ORDER.length - 1;

	const advanceToNextStep = (): void => {
		if (activeStepIndex === -1 || isLastStep) {
			navigate({ to: "/dashboard" });
			return;
		}
		setActiveStepId(STEP_ORDER[activeStepIndex + 1] ?? activeStepId);
	};

	const goBackToPreviousStep = (): void => {
		if (isFirstStep) {
			return;
		}
		setActiveStepId(STEP_ORDER[activeStepIndex - 1] ?? activeStepId);
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

	const activeStepDefinition =
		STEP_DEFINITIONS.find((d) => d.id === activeStepId) ?? STEP_DEFINITIONS[0];

	return (
		<OnboardingTwoPaneShell>
			<header className="border-border/70 border-b px-6 py-6 lg:px-10">
				<p className="font-medium text-foreground text-sm">
					Onboarding —{" "}
					<span className="text-muted-foreground">
						{activeStepDefinition.headerLabel}
					</span>
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

				<ActiveStepBody
					canAcceptRpTerms={isOwner}
					canEdit={canEdit}
					onSaved={advanceToNextStep}
					organization={organization}
					stepId={activeStepId}
				/>
			</OnboardingBody>

			<footer className="border-border/70 border-t px-6 py-4 lg:px-10">
				<div className="flex items-center justify-between gap-2">
					<Button
						disabled={isFirstStep}
						onClick={goBackToPreviousStep}
						type="button"
						variant="outline"
					>
						Back
					</Button>
					<div className="flex items-center gap-2">
						<Button
							onClick={() => navigate({ to: "/dashboard" })}
							type="button"
							variant="ghost"
						>
							Finish Later
						</Button>
						{isLastStep ? (
							<Button onClick={advanceToNextStep} type="button">
								Go to dashboard
							</Button>
						) : (
							<Button form="onboarding-form" type="submit">
								Continue
							</Button>
						)}
					</div>
				</div>
			</footer>
		</OnboardingTwoPaneShell>
	);
}

function OnboardingTwoPaneShell({ children }: { children: ReactNode }) {
	return (
		<>
			<section aria-hidden="true" className="hidden flex-1 lg:block" />
			<aside className="flex min-h-0 w-full flex-col lg:w-[480px] lg:border-border/70 lg:border-l xl:w-[560px]">
				{children}
			</aside>
		</>
	);
}

function OnboardingBody({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-1 flex-col overflow-y-auto px-6 py-6 lg:px-10 lg:py-8">
			<div className="mt-auto">{children}</div>
		</div>
	);
}

function ActiveStepBody({
	canAcceptRpTerms,
	canEdit,
	onSaved,
	organization,
	stepId,
}: {
	canAcceptRpTerms: boolean;
	canEdit: boolean;
	onSaved: () => void;
	organization: FullOrganization;
	stepId: OnboardingStepId;
}) {
	if (stepId === "business") {
		return (
			<BusinessDetailsForm
				canEdit={canEdit}
				compact
				onSaved={onSaved}
				organization={organization}
			/>
		);
	}
	if (stepId === "public") {
		return (
			<PublicDetailsForm
				canEdit={canEdit}
				compact
				onSaved={onSaved}
				organization={organization}
			/>
		);
	}
	if (stepId === "compliance") {
		return (
			<ComplianceForm
				canAcceptRpTerms={canAcceptRpTerms}
				canEdit={canEdit}
				compact
				onSaved={onSaved}
				organization={organization}
			/>
		);
	}
	return (
		<OwnerIdInlineStep
			canEdit={canEdit && canAcceptRpTerms}
			organization={organization}
		/>
	);
}

const OWNER_ID_TERMS: readonly { content: ReactNode; key: string }[] = [
	{
		key: "owner",
		content:
			"You confirm that you are an owner of this organization and authorized to verify it.",
	},
	{
		key: "id-check",
		content:
			"You will complete a Kayle ID identity check on a supported passport. The Kayle check result is bound to this organization.",
	},
	{
		key: "dedup",
		content:
			"Kayle ID stores a peppered hash of the document number for deduplication; raw document data is not retained outside the verification flow.",
	},
	{
		key: "legal",
		content:
			"By continuing you accept the Kayle ID Terms of Service and Privacy Policy as they apply to organization verification.",
	},
] as const;

function OwnerIdInlineStep({
	canEdit,
	organization,
}: {
	canEdit: boolean;
	organization: FullOrganization;
}) {
	const [errorMessage, setErrorMessage] = useState("");
	const startVerification = useMutation({
		mutationFn: async () => {
			if (!organization.verificationTermsAcceptedAt) {
				await acceptVerificationTerms(organization.id);
			}
			return await createOwnerVerificationSession({
				organizationId: organization.id,
			});
		},
		onSuccess: (session) => {
			window.location.href = session.verification_url;
		},
		onError: (err) => {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to start verification.",
			);
		},
	});

	if (!canEdit) {
		return (
			<p className="text-muted-foreground text-sm">
				Only an owner can complete the owner identity check.
			</p>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-muted-foreground text-sm">
				As the final step, an owner of{" "}
				<span className="font-semibold text-foreground">
					{organization.name}
				</span>{" "}
				must complete a one-time Kayle ID identity check. This binds the
				organization to a verified person.
			</p>
			<ul className="space-y-2 text-muted-foreground text-sm">
				{OWNER_ID_TERMS.map((bullet) => (
					<li className="flex gap-2" key={bullet.key}>
						<span aria-hidden="true">•</span>
						<span>{bullet.content}</span>
					</li>
				))}
			</ul>
			{errorMessage ? (
				<p className="text-destructive text-sm">{errorMessage}</p>
			) : null}
			<div>
				<Button
					disabled={startVerification.isPending}
					onClick={() => startVerification.mutate()}
					type="button"
				>
					{startVerification.isPending ? "Starting..." : "Accept and continue"}
				</Button>
			</div>
		</div>
	);
}
