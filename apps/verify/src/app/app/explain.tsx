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
import { Logo } from "@kayleai/ui/logo";
import { useLoaderData } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { requestCancelVerifySession } from "@/config/handoff";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { readCancelTokenFromLocation } from "@/utils/cancel";
import { useVerificationStore } from "../../stores/session";
import { useSession } from "../session-provider";
import { type Organization, OrganizationName } from "./organization-name";

type SessionExplainProps = {
	organization: Organization;
	isAgeOnly?: boolean;
	ageThreshold?: number | null;
};

/**
 * Explains the verification process. Age-only sessions render a narrower
 * variant since the generic "verify your identity" framing misrepresents
 * what the integrator actually receives (a single age-gate boolean).
 */
export function SessionExplain({
	organization,
	isAgeOnly = false,
	ageThreshold = null,
}: SessionExplainProps) {
	const goToConsent = useVerificationStore((state) => state.goToConsent);
	const copy = useVerifyHandoffCopy();

	if (isAgeOnly) {
		return (
			<AgeOnlyExplain
				ageThreshold={ageThreshold}
				goToConsent={goToConsent}
				organization={organization}
			/>
		);
	}

	const explainCopy = copy.screens.explain;

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex w-full max-w-md flex-col">
				{/* Header */}
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{explainCopy.headline}
					</h1>
					<p className="text-lg text-muted-foreground">{explainCopy.intro}</p>
				</div>

				{/* Body */}
				<div className="my-8 flex-1 space-y-6">
					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							{explainCopy.processTitle}
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>{explainCopy.processBulletAuthentic}</li>
							<li>{explainCopy.processBulletHolder}</li>
							<li>
								{explainCopy.processBulletSharingPrefix}
								<OrganizationName organization={organization} />
								{explainCopy.processBulletSharingSuffix}
							</li>
						</ul>
					</div>

					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							{explainCopy.kayleIdTitle}
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>{explainCopy.kayleIdBulletNoStorage}</li>
							<li>{explainCopy.kayleIdBulletNoAccount}</li>
							<li>{explainCopy.kayleIdBulletSessionScoped}</li>
						</ul>
					</div>
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col space-y-4">
					<Button onClick={goToConsent} type="button">
						{explainCopy.continueButton}
					</Button>
					<CancelExplainAction />
				</div>
			</div>
		</div>
	);
}

function AgeOnlyExplain({
	ageThreshold,
	goToConsent,
	organization,
}: {
	ageThreshold: number | null;
	goToConsent: () => void;
	organization: Organization;
}) {
	const copy = useVerifyHandoffCopy();
	const explainCopy = copy.screens.explain;
	const ageOnlyCopy = explainCopy.ageOnly;

	const ageLabel =
		ageThreshold !== null
			? interpolate(ageOnlyCopy.ageLabelWithThreshold, {
					threshold: ageThreshold,
				})
			: ageOnlyCopy.ageLabelGeneric;
	const headline =
		ageThreshold !== null
			? interpolate(ageOnlyCopy.headlineWithThreshold, {
					threshold: ageThreshold,
				})
			: ageOnlyCopy.headlineGeneric;
	const introSuffix = interpolate(ageOnlyCopy.introSuffix, { ageLabel });
	const yesNoQuestion = interpolate(ageOnlyCopy.yesNoBulletQuestion, {
		ageLabel,
	});

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex w-full max-w-md flex-col">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{headline}
					</h1>
					<p className="text-lg text-muted-foreground">
						{ageOnlyCopy.introPrefix}
						<OrganizationName isAgeOnly organization={organization} />
						{introSuffix}
					</p>
				</div>

				<div className="my-8 flex-1 space-y-6">
					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							{ageOnlyCopy.whatGetsSharedTitle}
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>
								{ageOnlyCopy.yesNoBulletPrefix}
								<span className="font-medium text-foreground">
									{yesNoQuestion}
								</span>
							</li>
							<li>{ageOnlyCopy.nothingElseBullet}</li>
						</ul>
					</div>

					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							{explainCopy.kayleIdTitle}
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>{explainCopy.kayleIdBulletNoStorage}</li>
							<li>{explainCopy.kayleIdBulletNoAccount}</li>
							<li>{explainCopy.kayleIdBulletSessionScoped}</li>
						</ul>
					</div>
				</div>

				<div className="flex flex-col space-y-4">
					<Button onClick={goToConsent} type="button">
						{explainCopy.continueButton}
					</Button>
					<CancelExplainAction />
				</div>
			</div>
		</div>
	);
}

function CancelExplainAction() {
	const copy = useVerifyHandoffCopy();
	const { sessionId } = useLoaderData({ from: "/$" });
	const { markSessionCancelled } = useSession();
	const goToHandoff = useVerificationStore((state) => state.goToHandoff);
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [isCancelInFlight, setIsCancelInFlight] = useState(false);
	const [cancelError, setCancelError] = useState<string | null>(null);

	const handleConfirmCancel = useCallback(async () => {
		const cancelToken = readCancelTokenFromLocation();
		if (!cancelToken) {
			setIsDialogOpen(false);
			setCancelError(copy.handoff.cancelError);
			return;
		}

		setIsCancelInFlight(true);
		try {
			await requestCancelVerifySession(sessionId, cancelToken);
			markSessionCancelled();
			setIsDialogOpen(false);
			setCancelError(null);
			goToHandoff();
		} catch {
			setIsDialogOpen(false);
			setCancelError(copy.handoff.cancelError);
		} finally {
			setIsCancelInFlight(false);
		}
	}, [copy.handoff.cancelError, goToHandoff, markSessionCancelled, sessionId]);

	return (
		<>
			<Button
				onClick={() => setIsDialogOpen(true)}
				type="button"
				variant="outline"
			>
				{copy.actions.cancel}
			</Button>
			{cancelError ? (
				<p className="text-center text-destructive text-sm" role="alert">
					{cancelError}
				</p>
			) : null}
			<AlertDialog
				onOpenChange={(open) => {
					if (isCancelInFlight) {
						return;
					}
					setIsDialogOpen(open);
				}}
				open={isDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{copy.cancelDialog.title}</AlertDialogTitle>
						<AlertDialogDescription>
							{copy.cancelDialog.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isCancelInFlight}>
							{copy.cancelDialog.dismiss}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={isCancelInFlight}
							onClick={() => {
								handleConfirmCancel().catch(() => {
									// handleConfirmCancel already stores the error state that the UI renders.
								});
							}}
							variant="destructive"
						>
							{copy.cancelDialog.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
