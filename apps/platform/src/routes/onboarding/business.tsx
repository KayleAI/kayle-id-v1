import { createFileRoute } from "@tanstack/react-router";
import { useOnboardingContext } from "@/app/onboarding/shell-context";
import { BusinessDetailsForm } from "@/app/organizations/business";

export const Route = createFileRoute("/onboarding/business")({
	component: OnboardingBusinessStep,
});

function OnboardingBusinessStep() {
	const { advanceToNextStep, canEdit, organization, setBusinessDraft } =
		useOnboardingContext();

	return (
		<BusinessDetailsForm
			canEdit={canEdit}
			compact
			onSaved={advanceToNextStep}
			onValuesChange={setBusinessDraft}
			organization={organization}
		/>
	);
}
