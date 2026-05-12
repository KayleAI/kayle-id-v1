import { interpolate } from "@kayle-id/translations/i18n";
import { Button } from "@kayleai/ui/button";
import { Checkbox } from "@kayleai/ui/checkbox";
import { Label } from "@kayleai/ui/label";
import { Logo } from "@kayleai/ui/logo";
import type { ReactNode } from "react";
import { useState } from "react";
import { useVerifyHandoffCopy } from "@/i18n/provider";
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
	const copy = useVerifyHandoffCopy();
	const consentCopy = copy.screens.consent;
	const ageOnlyCopy = copy.screens.explain.ageOnly;

	const handleStartVerification = () => {
		if (consentChecked) {
			goToHandoff();
		}
	};

	const ageLabel =
		ageThreshold !== null
			? interpolate(ageOnlyCopy.ageLabelWithThreshold, {
					threshold: ageThreshold,
				})
			: ageOnlyCopy.ageLabelGeneric;

	const heading = consentCopy.heading;
	const subheading = isAgeOnly
		? consentCopy.subheadingAgeOnly
		: consentCopy.subheadingFull;

	const shareAgeOnlyMiddle = interpolate(consentCopy.bulletShareAgeOnlyMiddle, {
		ageLabel,
	});

	const bullets: ReactNode[] = isAgeOnly
		? [
				<>{consentCopy.bulletReadDocAgeOnly}</>,
				<>{consentCopy.bulletSelfie}</>,
				<>
					{consentCopy.bulletShareAgeOnlyPrefix}
					<span className="font-medium">
						{consentCopy.bulletShareAgeOnlyEmphasis}
					</span>
					{shareAgeOnlyMiddle}
					<OrganizationName isAgeOnly organization={organization} />
					{consentCopy.bulletShareAgeOnlySuffix}
				</>,
			]
		: [
				<>{consentCopy.bulletReadDocFull}</>,
				<>{consentCopy.bulletSelfie}</>,
				<>
					{consentCopy.bulletShareFullPrefix}
					<OrganizationName organization={organization} />
					{consentCopy.bulletShareFullSuffix}
				</>,
			];

	const startLabel = isAgeOnly
		? consentCopy.startButtonAgeOnly
		: consentCopy.startButtonFull;

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex min-h-[calc(100dvh_-_6rem)] [@media(min-height:800px)]:min-h-[44rem] w-full max-w-md flex-col">
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
				<div className="my-8 flex-1 space-y-4">
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
								{consentCopy.agreementPrefix}
								<Button
									className="inline-block h-fit! p-0 text-foreground text-sm!"
									nativeButton={false}
									render={
										<a
											href="https://kayle.id/terms"
											rel="noopener noreferrer"
											target="_blank"
										>
											{consentCopy.termsOfServiceLink}
										</a>
									}
									variant="link"
								>
									{consentCopy.termsOfServiceLink}
								</Button>
								{consentCopy.agreementMiddle}
								<Button
									className="inline-block h-fit! p-0 text-foreground text-sm!"
									nativeButton={false}
									render={
										<a
											href="https://kayle.id/privacy"
											rel="noopener noreferrer"
											target="_blank"
										>
											{consentCopy.privacyNoticeLink}
										</a>
									}
									variant="link"
								>
									{consentCopy.privacyNoticeLink}
								</Button>
								{consentCopy.agreementSuffix}
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
						{consentCopy.backButton}
					</Button>
				</div>
			</div>
		</div>
	);
}
