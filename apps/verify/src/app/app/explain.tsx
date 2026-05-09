import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
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
import { readCancelTokenFromLocation } from "@/utils/cancel";
import { useVerificationStore } from "../../stores/session";
import { useSession } from "../session-provider";
import { getPlatformNameLabel } from "./platform-name";

type SessionExplainProps = {
	organizationName?: string | null;
	isAgeOnly?: boolean;
	ageThreshold?: number | null;
};

/**
 * Explains the verification process. Age-only sessions render a narrower
 * variant since the generic "verify your identity" framing misrepresents
 * what the integrator actually receives (a single age-gate boolean).
 */
export function SessionExplain({
	organizationName,
	isAgeOnly = false,
	ageThreshold = null,
}: SessionExplainProps) {
	const goToConsent = useVerificationStore((state) => state.goToConsent);
	const platformName = getPlatformNameLabel(organizationName);

	if (isAgeOnly) {
		return (
			<AgeOnlyExplain
				ageThreshold={ageThreshold}
				goToConsent={goToConsent}
				platformName={platformName}
			/>
		);
	}

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="w-full max-w-md space-y-8">
				{/* Header */}
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						Verify your identity with Kayle ID
					</h1>
					<p className="text-lg text-muted-foreground">
						Kayle ID lets you verify your identity using your document's chip
						and a selfie.
					</p>
				</div>

				{/* Body */}
				<div className="space-y-6">
					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							This process:
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>Confirms that your document is genuine</li>
							<li>Confirms that you are the document holder</li>
							<li>
								Shares only the verification result and details you choose to
								share with{" "}
								<span className="font-bold text-foreground underline decoration-dashed underline-offset-2">
									{platformName}
								</span>
							</li>
						</ul>
					</div>

					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							Kayle ID:
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>Does not store your document or selfie</li>
							<li>Does not create an account for you</li>
							<li>Processes data only for this verification session</li>
						</ul>
					</div>
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col space-y-4">
					<Button onClick={goToConsent} type="button">
						Continue
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
	platformName,
}: {
	ageThreshold: number | null;
	goToConsent: () => void;
	platformName: string;
}) {
	const ageLabel =
		ageThreshold !== null ? `over ${ageThreshold}` : "old enough";
	const headline =
		ageThreshold !== null
			? `Confirm you're over ${ageThreshold}`
			: "Confirm your age";

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="w-full max-w-md space-y-8">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{headline}
					</h1>
					<p className="text-lg text-muted-foreground">
						<span className="font-bold text-foreground underline decoration-dashed underline-offset-2">
							{platformName}
						</span>{" "}
						only needs to know whether you're {ageLabel} — not your name, date
						of birth, or any other personal details. Kayle ID lets you prove
						that privately, using your document and a selfie.
					</p>
				</div>

				<div className="space-y-6">
					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							What gets shared:
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>
								A single yes-or-no answer:{" "}
								<span className="font-medium text-foreground">
									are you {ageLabel}?
								</span>
							</li>
							<li>
								Nothing else — not your name, date of birth, document number,
								nationality, or photo
							</li>
						</ul>
					</div>

					<div>
						<h3 className="mb-2 font-medium text-base text-foreground">
							Kayle ID:
						</h3>
						<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
							<li>Does not store your document or selfie</li>
							<li>Does not create an account for you</li>
							<li>Processes data only for this verification session</li>
						</ul>
					</div>
				</div>

				<div className="flex flex-col space-y-4">
					<Button onClick={goToConsent} type="button">
						Continue
					</Button>
					<CancelExplainAction />
				</div>
			</div>
		</div>
	);
}

function CancelExplainAction() {
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
			setCancelError(VERIFY_HANDOFF_COPY.handoff.cancelError);
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
			setCancelError(VERIFY_HANDOFF_COPY.handoff.cancelError);
		} finally {
			setIsCancelInFlight(false);
		}
	}, [goToHandoff, markSessionCancelled, sessionId]);

	return (
		<>
			<Button
				onClick={() => setIsDialogOpen(true)}
				type="button"
				variant="outline"
			>
				{VERIFY_HANDOFF_COPY.actions.cancel}
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
						<AlertDialogTitle>
							{VERIFY_HANDOFF_COPY.cancelDialog.title}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{VERIFY_HANDOFF_COPY.cancelDialog.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isCancelInFlight}>
							{VERIFY_HANDOFF_COPY.cancelDialog.dismiss}
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
							{VERIFY_HANDOFF_COPY.cancelDialog.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
