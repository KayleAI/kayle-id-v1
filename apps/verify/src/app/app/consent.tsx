import { interpolate } from "@kayle-id/translations/i18n";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kayleai/ui/alert-dialog";
import { Button } from "@kayleai/ui/button";
import { Checkbox } from "@kayleai/ui/checkbox";
import { Label } from "@kayleai/ui/label";
import { Logo } from "@kayleai/ui/logo";
import type { ReactNode } from "react";
import { useState } from "react";
import {
	requestCancelVerifySession,
	requestRecordVerifyConsent,
} from "@/config/handoff";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { readCancelTokenFromLocation } from "@/utils/cancel";
import { useVerificationStore } from "../../stores/session";
import { type Organization, OrganizationName } from "./organization-name";

type SessionConsentProps = {
	sessionId: string;
	organization: Organization;
	isAgeOnly?: boolean;
	ageThreshold?: number | null;
	onSessionCancelled?: () => void;
};

type ConsentCheckboxProps = {
	checked: boolean;
	children: ReactNode;
	id: string;
	onCheckedChange: (checked: boolean) => void;
};

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

/**
 * Collects the user's consent. Age-only sessions render a narrower variant
 * since the integrator only receives a yes/no age answer — framing consent
 * around "share my document data" would be inaccurate and unnecessarily scary.
 */
export function SessionConsent({
	sessionId,
	organization,
	isAgeOnly = false,
	ageThreshold = null,
	onSessionCancelled,
}: SessionConsentProps) {
	const [hasAgreed, setHasAgreed] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [isRefusalDialogOpen, setIsRefusalDialogOpen] = useState(false);
	const [isRefusalInFlight, setIsRefusalInFlight] = useState(false);
	const goToHandoff = useVerificationStore((state) => state.goToHandoff);
	const copy = useVerifyHandoffCopy();
	const consentCopy = copy.screens.consent;
	const ageOnlyCopy = copy.screens.explain.ageOnly;

	const isConsentComplete = hasAgreed;

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
		if (isRefusalInFlight) {
			return;
		}

		setIsRefusalInFlight(true);
		setSubmitError(null);
		const cancelToken = readCancelTokenFromLocation();

		try {
			if (cancelToken) {
				await requestCancelVerifySession(sessionId, cancelToken);
			}
		} catch {
			// Refusing consent must still leave this browser flow in a terminal
			// state; the user has not agreed to start verification from here.
		} finally {
			onSessionCancelled?.();
			setIsRefusalDialogOpen(false);
			setIsRefusalInFlight(false);
			goToHandoff();
		}
	};

	const ageLabel =
		ageThreshold !== null
			? interpolate(ageOnlyCopy.ageLabelWithThreshold, {
					threshold: ageThreshold,
				})
			: ageOnlyCopy.ageLabelGeneric;
	const subheading = isAgeOnly
		? consentCopy.subheadingAgeOnly
		: consentCopy.subheadingFull;
	const shareAgeOnlyMiddle = interpolate(consentCopy.bulletShareAgeOnlyMiddle, {
		ageLabel,
	});
	const bullets: Array<{ key: string; content: ReactNode }> = isAgeOnly
		? [
				{
					key: "read-document-age",
					content: consentCopy.bulletReadDocAgeOnly,
				},
				{
					key: "selfie",
					content: consentCopy.bulletSelfie,
				},
				{
					key: "share-age",
					content: (
						<>
							{consentCopy.bulletShareAgeOnlyPrefix}
							<span className="font-medium">
								{consentCopy.bulletShareAgeOnlyEmphasis}
							</span>
							{shareAgeOnlyMiddle}
							<OrganizationName isAgeOnly organization={organization} />
							{consentCopy.bulletShareAgeOnlySuffix}
						</>
					),
				},
			]
		: [
				{
					key: "read-document",
					content: consentCopy.bulletReadDocFull,
				},
				{
					key: "selfie",
					content: consentCopy.bulletSelfie,
				},
				{
					key: "share-result",
					content: (
						<>
							{consentCopy.bulletShareFullPrefix}
							<OrganizationName organization={organization} />
							{consentCopy.bulletShareFullSuffix}
						</>
					),
				},
			];
	const startLabel = isAgeOnly
		? consentCopy.startButtonAgeOnly
		: consentCopy.startButtonFull;

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex w-full max-w-md flex-col">
				{/* Header */}
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{consentCopy.heading}
					</h1>
					<p className="text-lg text-muted-foreground">{subheading}</p>
				</div>

				{/* Body */}
				<div className="my-8 flex-1 space-y-4">
					<ul className="list-disc space-y-2 pl-5 text-base text-muted-foreground">
						{bullets.map((bullet) => (
							<li key={bullet.key}>{bullet.content}</li>
						))}
					</ul>

					<div className="space-y-4">
						<ConsentCheckbox
							checked={hasAgreed}
							id="verification-consent"
							onCheckedChange={setHasAgreed}
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
							setIsRefusalDialogOpen(true);
						}}
						type="button"
						variant="outline"
					>
						{consentCopy.declineButton}
					</Button>
				</div>
				<AlertDialog
					onOpenChange={(open) => {
						if (isRefusalInFlight) {
							return;
						}
						setIsRefusalDialogOpen(open);
					}}
					open={isRefusalDialogOpen}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{consentCopy.refusalDialogTitle}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{consentCopy.refusalDialogDescriptionPrefix}
								<OrganizationName organization={organization} />
								{consentCopy.refusalDialogDescriptionSuffix}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={isRefusalInFlight}>
								{consentCopy.refusalDialogDismiss}
							</AlertDialogCancel>
							<AlertDialogAction
								disabled={isRefusalInFlight}
								onClick={() => {
									handleRefuse().catch(() => {
										onSessionCancelled?.();
										setIsRefusalDialogOpen(false);
										setIsRefusalInFlight(false);
										goToHandoff();
									});
								}}
								variant="destructive"
							>
								{consentCopy.refusalDialogConfirm}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
}
