import { createFileRoute } from "@tanstack/react-router";
import { useOnboardingContext } from "@/app/onboarding/shell-context";
import { ComplianceForm } from "@/app/organizations/compliance";

export const Route = createFileRoute("/onboarding/compliance")({
	component: OnboardingComplianceStep,
});

function OnboardingComplianceStep() {
	const {
		advanceToNextStep,
		canAcceptRpTerms,
		canEdit,
		organization,
		setComplianceDraft,
	} = useOnboardingContext();

	return (
		<ComplianceForm
			canAcceptRpTerms={canAcceptRpTerms}
			canEdit={canEdit}
			compact
			onSaved={advanceToNextStep}
			onValuesChange={setComplianceDraft}
			organization={organization}
		/>
	);
}
