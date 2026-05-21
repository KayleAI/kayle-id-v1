import { interpolate } from "@kayle-id/translations/i18n";
import { Button } from "@kayle-id/ui/components/button";
import { Checkbox } from "@kayle-id/ui/components/checkbox";
import { Label } from "@kayle-id/ui/components/label";
import type { ReactNode } from "react";
import { useState } from "react";
import { requestRecordVerifyConsent } from "@/api/verify-api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { useCancelSession } from "@/hooks/use-cancel-session";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { useVerificationStore } from "@/stores/session";
import { readCancelTokenFromLocation } from "@/utils/cancel";
import { OrganizationName } from "./organization/name";
import type { Organization } from "./organization/types";

type SessionConsentProps = {
	sessionId: string;
	organization: Organization;
	isAgeOnly?: boolean;
	ageThreshold?: number | null;
	onSessionCancelled?: () => void;
};

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
	const cancelSession = useCancelSession(sessionId);
	const isRefusalInFlight = cancelSession.state === "pending";
	const goToHandoff = useVerificationStore((state) => state.goToHandoff);
	const copy = useVerifyHandoffCopy();
	const consentCopy = copy.screens.consent;
	const ageOnlyCopy = copy.screens.explain.ageOnly;

	const handleStartVerification = async () => {
		if (!hasAgreed || isSubmitting) {
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

		setSubmitError(null);
		await cancelSession.cancel(readCancelTokenFromLocation());
		onSessionCancelled?.();
		setIsRefusalDialogOpen(false);
		goToHandoff();
	};

	const bullets = isAgeOnly
		? buildAgeOnlyBullets({
				ageOnlyCopy,
				ageThreshold,
				copy: consentCopy,
				organization,
			})
		: buildFullBullets({ copy: consentCopy, organization });
	const startLabel = isAgeOnly
		? consentCopy.startButtonAgeOnly
		: consentCopy.startButtonFull;
	const subheading = isAgeOnly
		? consentCopy.subheadingAgeOnly
		: consentCopy.subheadingFull;

	return (
		<PageShell
			heading={consentCopy.heading}
			description={subheading}
			actions={
				<>
					<Button
						disabled={!hasAgreed || isSubmitting}
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
						onClick={() => setIsRefusalDialogOpen(true)}
						type="button"
						variant="outline"
					>
						{consentCopy.declineButton}
					</Button>
				</>
			}
		>
			<div className="my-8 flex-1 space-y-4">
				<ul className="list-disc space-y-2 pl-5 text-base text-muted-foreground">
					{bullets.map((bullet) => (
						<li key={bullet.key}>{bullet.content}</li>
					))}
				</ul>

				<ConsentCheckbox
					checked={hasAgreed}
					id="verification-consent"
					onCheckedChange={setHasAgreed}
				>
					{consentCopy.agreementPrefix}
					<LegalLink href="https://kayle.id/terms">
						{consentCopy.termsOfServiceLink}
					</LegalLink>
					{consentCopy.agreementMiddle}
					<LegalLink href="https://kayle.id/privacy">
						{consentCopy.privacyNoticeLink}
					</LegalLink>
					{consentCopy.agreementSuffix}
				</ConsentCheckbox>

				{submitError ? (
					<p className="text-destructive text-sm">{submitError}</p>
				) : null}
			</div>

			<ConfirmDialog
				confirmLabel={consentCopy.refusalDialogConfirm}
				description={
					<>
						{consentCopy.refusalDialogDescriptionPrefix}
						<OrganizationName organization={organization} />
						{consentCopy.refusalDialogDescriptionSuffix}
					</>
				}
				dismissLabel={consentCopy.refusalDialogDismiss}
				inFlight={isRefusalInFlight}
				onConfirm={() => {
					handleRefuse().catch(() => {
						onSessionCancelled?.();
						setIsRefusalDialogOpen(false);
						goToHandoff();
					});
				}}
				onOpenChange={setIsRefusalDialogOpen}
				open={isRefusalDialogOpen}
				title={consentCopy.refusalDialogTitle}
			/>
		</PageShell>
	);
}

function ConsentCheckbox({
	checked,
	children,
	id,
	onCheckedChange,
}: {
	checked: boolean;
	children: ReactNode;
	id: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-start gap-3">
			<Checkbox
				checked={checked}
				className="mt-0.5 size-6 rounded-full"
				id={id}
				onCheckedChange={(next) => onCheckedChange(next === true)}
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

function LegalLink({ children, href }: { children: ReactNode; href: string }) {
	return (
		<Button
			className="inline-block h-fit! p-0 text-foreground text-sm!"
			nativeButton={false}
			render={
				<a href={href} rel="noopener noreferrer" target="_blank">
					{children}
				</a>
			}
			variant="link"
		>
			{children}
		</Button>
	);
}

type ConsentCopy = ReturnType<
	typeof useVerifyHandoffCopy
>["screens"]["consent"];
type AgeOnlyCopy = ReturnType<
	typeof useVerifyHandoffCopy
>["screens"]["explain"]["ageOnly"];

function buildFullBullets({
	copy,
	organization,
}: {
	copy: ConsentCopy;
	organization: Organization;
}): { key: string; content: ReactNode }[] {
	return [
		{ key: "read-document", content: copy.bulletReadDocFull },
		{ key: "selfie", content: copy.bulletSelfie },
		{
			key: "share-result",
			content: (
				<>
					{copy.bulletShareFullPrefix}
					<OrganizationName organization={organization} />
					{copy.bulletShareFullSuffix}
				</>
			),
		},
	];
}

function buildAgeOnlyBullets({
	ageOnlyCopy,
	ageThreshold,
	copy,
	organization,
}: {
	ageOnlyCopy: AgeOnlyCopy;
	ageThreshold: number | null;
	copy: ConsentCopy;
	organization: Organization;
}): { key: string; content: ReactNode }[] {
	const ageLabel =
		ageThreshold !== null
			? interpolate(ageOnlyCopy.ageLabelWithThreshold, {
					threshold: ageThreshold,
				})
			: ageOnlyCopy.ageLabelGeneric;
	const shareAgeOnlyMiddle = interpolate(copy.bulletShareAgeOnlyMiddle, {
		ageLabel,
	});

	return [
		{ key: "read-document-age", content: copy.bulletReadDocAgeOnly },
		{ key: "selfie", content: copy.bulletSelfie },
		{
			key: "share-age",
			content: (
				<>
					{copy.bulletShareAgeOnlyPrefix}
					<span className="font-medium">{copy.bulletShareAgeOnlyEmphasis}</span>
					{shareAgeOnlyMiddle}
					<OrganizationName isAgeOnly organization={organization} />
					{copy.bulletShareAgeOnlySuffix}
				</>
			),
		},
	];
}
