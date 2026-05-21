import { createFileRoute } from "@tanstack/react-router";
import { useOnboardingContext } from "@/app/onboarding/shell-context";
import { PublicDetailsForm } from "@/app/organizations/public-details";

export const Route = createFileRoute("/onboarding/public")({
	component: OnboardingPublicStep,
});

function OnboardingPublicStep() {
	const { advanceToNextStep, canEdit, organization, setPublicDraft } =
		useOnboardingContext();

	return (
		<PublicDetailsForm
			canEdit={canEdit}
			compact
			onSaved={advanceToNextStep}
			onValuesChange={setPublicDraft}
			organization={organization}
		/>
	);
}
