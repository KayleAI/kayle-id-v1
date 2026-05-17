import { getClaimLabel, isAgeOverClaim } from "@kayle-id/config/share-claims";
import { interpolate } from "@kayle-id/translations/i18n";
import { Button } from "@kayleai/ui/button";
import { Checkbox } from "@kayleai/ui/checkbox";
import { Label } from "@kayleai/ui/label";
import { Logo } from "@kayleai/ui/logo";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
	requestCancelVerifySession,
	requestRecordVerifyConsent,
	type VerifySessionShareFields,
} from "@/config/handoff";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { readCancelTokenFromLocation } from "@/utils/cancel";
import { useVerificationStore } from "../../stores/session";
import { type Organization, OrganizationName } from "./organization-name";

type SessionConsentProps = {
	sessionId: string;
	organization: Organization;
	shareFields: VerifySessionShareFields;
	isAgeOnly?: boolean;
	ageThreshold?: number | null;
	onSessionCancelled?: () => void;
};

type ConsentControlKey =
	| "biometricConsent"
	| "documentProcessingConsent"
	| "privacyNoticeAcknowledged"
	| "shareClaimsConsent"
	| "termsAcknowledged";

type ConsentControls = Record<ConsentControlKey, boolean>;

type ClaimManifestGroup = {
	key: "age" | "optional" | "required" | "security";
	title: string;
	description: string;
	fields: Array<{
		key: string;
		label: string;
		reason: string;
		required: boolean;
	}>;
};

type ConsentCheckboxProps = {
	checked: boolean;
	children: ReactNode;
	id: string;
	onCheckedChange: (checked: boolean) => void;
};

const initialConsentControls: ConsentControls = {
	biometricConsent: false,
	documentProcessingConsent: false,
	privacyNoticeAcknowledged: false,
	shareClaimsConsent: false,
	termsAcknowledged: false,
};

const securityClaimKeys = new Set(["kayle_document_id", "kayle_human_id"]);

function ConsentCheckbox({
	checked,
	children,
	id,
	onCheckedChange,
}: ConsentCheckboxProps) {
	return (
		<div className="flex items-start gap-3">
			<Checkbox
				checked={checked}
				className="mt-0.5 size-6 rounded-full"
				id={id}
				onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
			/>
			<Label
				className="block font-normal text-muted-foreground! text-sm leading-normal"
				htmlFor={id}
			>
				{children}
			</Label>
		</div>
	);
}

function buildClaimManifestGroups({
	shareFields,
	copy,
}: {
	shareFields: VerifySessionShareFields;
	copy: ReturnType<typeof useVerifyHandoffCopy>["screens"]["consent"];
}): ClaimManifestGroup[] {
	const groups: ClaimManifestGroup[] = [
		{
			key: "age",
			title: copy.ageOnlyClaimsTitle,
			description: copy.ageOnlyClaimsDescription,
			fields: [],
		},
		{
			key: "required",
			title: copy.requiredClaimsTitle,
			description: copy.requiredClaimsDescription,
			fields: [],
		},
		{
			key: "optional",
			title: copy.optionalClaimsTitle,
			description: copy.optionalClaimsDescription,
			fields: [],
		},
		{
			key: "security",
			title: copy.securityClaimsTitle,
			description: copy.securityClaimsDescription,
			fields: [],
		},
	];
	const groupByKey = new Map(groups.map((group) => [group.key, group]));

	for (const [key, field] of Object.entries(shareFields)) {
		const groupKey = isAgeOverClaim(key)
			? "age"
			: securityClaimKeys.has(key)
				? "security"
				: field.required
					? "required"
					: "optional";

		groupByKey.get(groupKey)?.fields.push({
			key,
			label: getClaimLabel(key),
			reason: field.reason,
			required: field.required,
		});
	}

	return groups
		.map((group) => ({
			...group,
			fields: group.fields.sort((left, right) =>
				left.label.localeCompare(right.label),
			),
		}))
		.filter((group) => group.fields.length > 0);
}

/**
 * Collects the user's consent. Age-only sessions render a narrower variant
 * since the integrator only receives a yes/no age answer — framing consent
 * around "share my document data" would be inaccurate and unnecessarily scary.
 */
export function SessionConsent({
	sessionId,
	organization,
	shareFields,
	isAgeOnly = false,
	ageThreshold = null,
	onSessionCancelled,
}: SessionConsentProps) {
	const [consents, setConsents] = useState<ConsentControls>(
		initialConsentControls,
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [hasRefused, setHasRefused] = useState(false);
	const goToHandoff = useVerificationStore((state) => state.goToHandoff);
	const goToExplain = useVerificationStore((state) => state.goToExplain);
	const copy = useVerifyHandoffCopy();
	const consentCopy = copy.screens.consent;
	const ageOnlyCopy = copy.screens.explain.ageOnly;
	const claimManifestGroups = useMemo(
		() =>
			buildClaimManifestGroups({
				shareFields,
				copy: consentCopy,
			}),
		[consentCopy, shareFields],
	);

	const isConsentComplete = Object.values(consents).every(Boolean);

	const updateConsent = (key: ConsentControlKey, checked: boolean) => {
		setConsents((current) => ({
			...current,
			[key]: checked,
		}));
	};

	const handleStartVerification = async () => {
		if (!(isConsentComplete && !isSubmitting)) {
			return;
		}

		setIsSubmitting(true);
		setSubmitError(null);

		try {
			await requestRecordVerifyConsent(sessionId, {
				biometric_consent: true,
				document_processing_consent: true,
				privacy_notice_acknowledged: true,
				share_claims_consent: true,
				terms_acknowledged: true,
			});
			goToHandoff();
		} catch {
			setSubmitError(consentCopy.submitError);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleRefuse = async () => {
		setSubmitError(null);
		const cancelToken = readCancelTokenFromLocation();

		if (cancelToken) {
			try {
				await requestCancelVerifySession(sessionId, cancelToken);
				onSessionCancelled?.();
			} catch {
				setSubmitError(consentCopy.refusalCancelError);
			}
		}

		setHasRefused(true);
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
				consentCopy.bulletReadDocAgeOnly,
				consentCopy.bulletSelfie,
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
				consentCopy.bulletReadDocFull,
				consentCopy.bulletSelfie,
				<>
					{consentCopy.bulletShareFullPrefix}
					<OrganizationName organization={organization} />
					{consentCopy.bulletShareFullSuffix}
				</>,
			];

	const startLabel = isAgeOnly
		? consentCopy.startButtonAgeOnly
		: consentCopy.startButtonFull;
	const organizationLabel = organization.name ?? consentCopy.defaultRpName;
	const fallbackUrl = organization.website;

	if (hasRefused) {
		return (
			<div className="relative flex w-full flex-col items-center justify-center">
				<div className="flex w-full max-w-md flex-col">
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{consentCopy.refusalHeading}
					</h1>
					<p className="text-lg text-muted-foreground">
						{interpolate(consentCopy.refusalDescription, {
							organization: organizationLabel,
						})}
					</p>
					{submitError ? (
						<p className="mt-4 text-destructive text-sm">{submitError}</p>
					) : null}
					<div className="mt-8 flex flex-col space-y-4">
						{fallbackUrl ? (
							<Button
								nativeButton={false}
								render={
									<a
										href={fallbackUrl}
										rel="noopener noreferrer"
										target="_blank"
									>
										{interpolate(consentCopy.refusalContactButton, {
											organization: organizationLabel,
										})}
									</a>
								}
								variant="outline"
							>
								{interpolate(consentCopy.refusalContactButton, {
									organization: organizationLabel,
								})}
							</Button>
						) : null}
						<Button onClick={goToExplain} type="button">
							{consentCopy.refusalBackButton}
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex w-full max-w-md flex-col">
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

					<div className="space-y-5">
						<div>
							<h2 className="font-medium text-base text-foreground">
								{consentCopy.claimManifestTitle}
							</h2>
							<p className="mt-1 text-muted-foreground text-sm">
								{consentCopy.claimManifestDescription}
							</p>
						</div>

						<div className="space-y-3">
							{claimManifestGroups.map((group) => (
								<section
									aria-labelledby={`claim-group-${group.key}`}
									className="rounded-md border border-border p-4"
									key={group.key}
								>
									<h3
										className="font-medium text-foreground text-sm"
										id={`claim-group-${group.key}`}
									>
										{group.title}
									</h3>
									<p className="mt-1 text-muted-foreground text-xs">
										{group.description}
									</p>
									<ul className="mt-3 space-y-3">
										{group.fields.map((field) => (
											<li className="min-w-0" key={field.key}>
												<div className="flex flex-wrap items-center gap-2">
													<span className="font-medium text-foreground text-sm">
														{field.label}
													</span>
													<span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
														{field.required
															? consentCopy.requiredBadge
															: consentCopy.optionalBadge}
													</span>
												</div>
												<p className="mt-1 text-muted-foreground text-xs">
													{field.reason}
												</p>
											</li>
										))}
									</ul>
								</section>
							))}
						</div>
					</div>

					<div className="space-y-4">
						<ConsentCheckbox
							checked={consents.documentProcessingConsent}
							id="document-processing-consent"
							onCheckedChange={(checked) =>
								updateConsent("documentProcessingConsent", checked)
							}
						>
							{isAgeOnly
								? consentCopy.documentProcessingConsentAgeOnly
								: consentCopy.documentProcessingConsentFull}
						</ConsentCheckbox>

						<ConsentCheckbox
							checked={consents.biometricConsent}
							id="biometric-consent"
							onCheckedChange={(checked) =>
								updateConsent("biometricConsent", checked)
							}
						>
							{consentCopy.biometricConsent}
						</ConsentCheckbox>

						<ConsentCheckbox
							checked={consents.shareClaimsConsent}
							id="share-claims-consent"
							onCheckedChange={(checked) =>
								updateConsent("shareClaimsConsent", checked)
							}
						>
							{isAgeOnly
								? interpolate(consentCopy.shareClaimsConsentAgeOnly, {
										ageLabel,
										organization: organizationLabel,
									})
								: interpolate(consentCopy.shareClaimsConsentFull, {
										organization: organizationLabel,
									})}
						</ConsentCheckbox>

						<ConsentCheckbox
							checked={consents.termsAcknowledged}
							id="terms-acknowledgement"
							onCheckedChange={(checked) =>
								updateConsent("termsAcknowledged", checked)
							}
						>
							{consentCopy.termsAcknowledgementPrefix}
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
							{consentCopy.termsAcknowledgementSuffix}
						</ConsentCheckbox>

						<ConsentCheckbox
							checked={consents.privacyNoticeAcknowledged}
							id="privacy-notice-acknowledgement"
							onCheckedChange={(checked) =>
								updateConsent("privacyNoticeAcknowledged", checked)
							}
						>
							{consentCopy.privacyAcknowledgementPrefix}
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
							{consentCopy.privacyAcknowledgementSuffix}
						</ConsentCheckbox>
					</div>

					{submitError ? (
						<p className="text-destructive text-sm">{submitError}</p>
					) : null}
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col space-y-4">
					<Button
						disabled={!isConsentComplete || isSubmitting}
						onClick={() => {
							handleStartVerification().catch(() => {
								setSubmitError(consentCopy.submitError);
							});
						}}
						type="button"
					>
						{isSubmitting ? consentCopy.startButtonPending : startLabel}
					</Button>
					<Button
						onClick={() => {
							handleRefuse().catch(() => {
								setSubmitError(consentCopy.refusalCancelError);
							});
						}}
						type="button"
						variant="outline"
					>
						{consentCopy.declineButton}
					</Button>
					<Button onClick={goToExplain} type="button" variant="outline">
						{consentCopy.backButton}
					</Button>
				</div>
			</div>
		</div>
	);
}
