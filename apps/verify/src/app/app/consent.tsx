import { Button } from "@kayleai/ui/button";
import { Checkbox } from "@kayleai/ui/checkbox";
import { Label } from "@kayleai/ui/label";
import { Logo } from "@kayleai/ui/logo";
import type { ReactNode } from "react";
import { useState } from "react";
import { useVerificationStore } from "../../stores/session";
import { type Organization, OrganizationName } from "./organization-name";

type SessionConsentProps = {
	organization: Organization;
	isAgeOnly?: boolean;
	ageThreshold?: number | null;
};

/**
 * Collects the user's consent. Age-only sessions render a narrower variant
 * since the integrator only receives a yes/no age answer — framing consent
 * around "share my document data" would be inaccurate and unnecessarily scary.
 */
export function SessionConsent({
	organization,
	isAgeOnly = false,
	ageThreshold = null,
}: SessionConsentProps) {
	const [consentChecked, setConsentChecked] = useState(false);
	const goToHandoff = useVerificationStore((state) => state.goToHandoff);
	const goToExplain = useVerificationStore((state) => state.goToExplain);

	const handleStartVerification = () => {
		if (consentChecked) {
			goToHandoff();
		}
	};

	const ageLabel =
		ageThreshold !== null ? `over ${ageThreshold}` : "old enough";

	const heading = "Your consent is required";
	const subheading = isAgeOnly
		? "To prove your age, you must agree to the following:"
		: "To continue, you must agree to the following:";

	const bullets: ReactNode[] = isAgeOnly
		? [
				<>I allow Kayle ID to read my document to check my age</>,
				<>
					I allow Kayle ID to capture a selfie to confirm I am the document
					holder
				</>,
				<>
					I allow Kayle ID to share <span className="font-medium">only</span>{" "}
					whether I am {ageLabel} with{" "}
					<OrganizationName isAgeOnly organization={organization} /> — no other
					details
				</>,
			]
		: [
				<>I allow Kayle ID to read data from my document</>,
				<>
					I allow Kayle ID to capture a selfie to confirm I am the document
					holder
				</>,
				<>
					I allow Kayle ID to share the verification result and details I choose
					to share with <OrganizationName organization={organization} />
				</>,
			];

	const startLabel = isAgeOnly ? "Confirm my age" : "Start verification";

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="w-full max-w-md space-y-8">
				{/* Header */}
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{heading}
					</h1>
					<p className="text-lg text-muted-foreground">{subheading}</p>
				</div>

				{/* Body */}
				<div className="space-y-4">
					<ul className="list-disc space-y-2 pl-5 text-base text-muted-foreground">
						{bullets.map((bullet, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: bullets are a static, ordered, never-reordered list
							<li key={index}>{bullet}</li>
						))}
					</ul>

					<div className="space-y-4">
						<div className="flex items-center space-x-3">
							<Checkbox
								checked={consentChecked}
								className="size-7 rounded-full"
								id="consent"
								onCheckedChange={(checked) =>
									setConsentChecked(checked === true)
								}
							/>
							<Label
								className="block font-normal text-muted-foreground! text-sm leading-normal"
								htmlFor="consent"
							>
								I agree to the{" "}
								<Button
									className="inline-block h-fit! p-0 text-foreground text-sm!"
									nativeButton={false}
									render={
										<a
											href="https://kayle.id/terms"
											rel="noopener noreferrer"
											target="_blank"
										>
											Terms of Service
										</a>
									}
									variant="link"
								>
									Terms of Service
								</Button>{" "}
								and{" "}
								<Button
									className="inline-block h-fit! p-0 text-foreground text-sm!"
									nativeButton={false}
									render={
										<a
											href="https://kayle.id/privacy"
											rel="noopener noreferrer"
											target="_blank"
										>
											Privacy Notice
										</a>
									}
									variant="link"
								>
									Privacy Notice
								</Button>{" "}
								and consent to identity verification.
							</Label>
						</div>
					</div>
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col space-y-4">
					<Button
						disabled={!consentChecked}
						onClick={handleStartVerification}
						type="button"
					>
						{startLabel}
					</Button>
					<Button onClick={goToExplain} type="button" variant="outline">
						Back
					</Button>
				</div>
			</div>
		</div>
	);
}
