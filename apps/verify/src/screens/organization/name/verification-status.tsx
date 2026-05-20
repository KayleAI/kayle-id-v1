import { StatusCallout } from "@/components/status-callout";
import { useVerifyHandoffCopy } from "@/i18n/provider";

export function VerificationStatusCallout({
	verified,
	isAgeOnly,
}: {
	verified: boolean;
	isAgeOnly: boolean;
}) {
	const { org } = useVerifyHandoffCopy();

	if (verified) {
		return (
			<StatusCallout
				tone="emerald"
				title={org.ownerVerifiedTitle}
				description={org.ownerVerifiedDescription}
			/>
		);
	}

	// Age-only sessions only share a yes/no — soften the warning to amber.
	return (
		<StatusCallout
			tone={isAgeOnly ? "amber" : "red"}
			title={org.ownerNotVerifiedTitle}
			description={org.ownerNotVerifiedDescription}
		/>
	);
}
