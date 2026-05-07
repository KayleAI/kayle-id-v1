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
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
	acceptVerificationTerms,
	createOwnerVerificationSession,
	type FullOrganization,
} from "./api";

const LEGAL_LINK_CLASS =
	"font-medium text-foreground underline decoration-dashed underline-offset-2";

const TERMS_BULLETS: readonly { content: ReactNode; key: string }[] = [
	{
		key: "owner",
		content:
			"You confirm that you are an owner of this organization and authorized to verify it.",
	},
	{
		key: "id-check",
		content:
			"You will complete a Kayle ID identity check on a supported passport. The verification result is bound to this organization.",
	},
	{
		key: "dedup",
		content:
			"Kayle ID stores a peppered hash of the document number for deduplication; raw document data is not retained outside the verification flow.",
	},
	{
		key: "legal",
		content: (
			<>
				By continuing you accept the Kayle ID{" "}
				<a
					className={LEGAL_LINK_CLASS}
					href="/terms"
					rel="noopener noreferrer"
					target="_blank"
				>
					Terms of Service
				</a>{" "}
				and{" "}
				<a
					className={LEGAL_LINK_CLASS}
					href="/privacy"
					rel="noopener noreferrer"
					target="_blank"
				>
					Privacy Policy
				</a>{" "}
				as they apply to organization verification.
			</>
		),
	},
];

interface StartVerificationDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organization: FullOrganization;
}

export function StartVerificationDialog({
	onOpenChange,
	open,
	organization,
}: StartVerificationDialogProps) {
	const [errorMessage, setErrorMessage] = useState("");

	const startVerification = useMutation({
		mutationFn: async () => {
			if (!organization.verificationTermsAcceptedAt) {
				await acceptVerificationTerms(organization.id);
			}
			return await createOwnerVerificationSession({
				organizationId: organization.id,
			});
		},
		onSuccess: (session) => {
			window.location.href = session.verification_url;
		},
		onError: (err) => {
			const message =
				err instanceof Error ? err.message : "Failed to start verification.";
			setErrorMessage(message);
			toast.error(message);
		},
	});

	const handleOpenChange = (next: boolean) => {
		if (startVerification.isPending) {
			return;
		}
		setErrorMessage("");
		onOpenChange(next);
	};

	return (
		<AlertDialog onOpenChange={handleOpenChange} open={open}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Verify this organization</AlertDialogTitle>
					<AlertDialogDescription>
						An owner of{" "}
						<span className="font-semibold text-foreground">
							{organization.name}
						</span>{" "}
						must complete a one-time identity check to verify the organization.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<ul className="space-y-2 pb-2 text-muted-foreground text-sm">
					{TERMS_BULLETS.map((bullet) => (
						<li className="flex gap-2" key={bullet.key}>
							<span aria-hidden="true">•</span>
							<span>{bullet.content}</span>
						</li>
					))}
				</ul>
				{errorMessage ? (
					<p className="text-destructive text-sm">{errorMessage}</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel
						disabled={startVerification.isPending}
						variant="secondary"
					>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={startVerification.isPending}
						onClick={() => startVerification.mutate()}
					>
						{startVerification.isPending
							? "Starting..."
							: "Accept and continue"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
