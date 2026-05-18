import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useOnboardingContext } from "@/app/onboarding/shell-context";
import {
	acceptVerificationTerms,
	createOwnerVerificationSession,
	type FullOrganization,
} from "@/app/organizations/api";

export const Route = createFileRoute("/onboarding/owner-id")({
	component: OnboardingOwnerIdStep,
});

const OWNER_ID_TERMS: readonly { content: ReactNode; key: string }[] = [
	{
		key: "owner",
		content:
			"You confirm that you are an owner of this organization and authorized to verify it.",
	},
	{
		key: "id-check",
		content:
			"You will complete a Kayle ID identity check on a supported passport. The Kayle check result is bound to this organization.",
	},
	{
		key: "dedup",
		content:
			"Kayle ID stores a peppered hash of the document number for deduplication; raw document data is not retained outside the verification flow.",
	},
	{
		key: "legal",
		content:
			"By continuing you accept the Kayle ID Terms of Service and Privacy Policy as they apply to organization verification.",
	},
] as const;

function OnboardingOwnerIdStep() {
	const { canAcceptRpTerms, canEdit, organization } = useOnboardingContext();
	return (
		<OwnerIdInlineStep
			canEdit={canEdit && canAcceptRpTerms}
			organization={organization}
		/>
	);
}

function OwnerIdInlineStep({
	canEdit,
	organization,
}: {
	canEdit: boolean;
	organization: FullOrganization;
}) {
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
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to start verification.",
			);
		},
	});

	if (organization.verifiedAt !== null) {
		return (
			<div className="space-y-6">
				<div className="space-y-2">
					<h1 className="font-semibold text-2xl text-foreground tracking-tight">
						Owner identity check complete
					</h1>
					<p className="text-muted-foreground text-sm">
						An owner of{" "}
						<span className="font-semibold text-foreground">
							{organization.name}
						</span>{" "}
						completed an identity check, and the result was associated with this
						organization.
					</p>
				</div>
				<ul className="space-y-2 text-muted-foreground text-sm">
					{OWNER_ID_TERMS.map((bullet) => (
						<li className="flex gap-2" key={bullet.key}>
							<span aria-hidden="true">•</span>
							<span>{bullet.content}</span>
						</li>
					))}
				</ul>
			</div>
		);
	}

	if (!canEdit) {
		return (
			<p className="text-muted-foreground text-sm">
				Only an owner can complete the owner identity check.
			</p>
		);
	}

	return (
		<form
			className="space-y-6"
			id="onboarding-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (startVerification.isPending) {
					return;
				}
				startVerification.mutate();
			}}
		>
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl text-foreground tracking-tight">
					Owner identity check
				</h1>
				<p className="text-muted-foreground text-sm">
					As the final step, an owner of{" "}
					<span className="font-semibold text-foreground">
						{organization.name}
					</span>{" "}
					must complete a one-time Kayle ID identity check. This binds the
					organization to a verified person.
				</p>
			</div>
			<ul className="space-y-2 text-muted-foreground text-sm">
				{OWNER_ID_TERMS.map((bullet) => (
					<li className="flex gap-2" key={bullet.key}>
						<span aria-hidden="true">•</span>
						<span>{bullet.content}</span>
					</li>
				))}
			</ul>
			{errorMessage ? (
				<p className="text-destructive text-sm">{errorMessage}</p>
			) : null}
		</form>
	);
}
