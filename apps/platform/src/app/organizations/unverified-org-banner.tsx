import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayleai/ui/button";
import { Link } from "@tanstack/react-router";
import { useOnboardingStatus } from "@/app/onboarding/use-onboarding-status";

function isOwnerRole(role: string | undefined): boolean {
	return role?.split(",").includes("owner") ?? false;
}

/**
 * Shown on every organization page until the org has finished the four-step
 * onboarding flow (business, public, compliance, owner ID check). Replaces
 * the legacy "this organization is not verified" notice — the gate now spans
 * more than just owner identity verification.
 */
export function UnverifiedOrgBanner() {
	const { user } = useAuth();
	const { complete, organization, steps } = useOnboardingStatus();

	if (!organization || complete) {
		return null;
	}
	if (organization.pendingDeletionAt) {
		return null;
	}

	const currentMembership = organization.members.find(
		(member) => member.userId === user?.id,
	);
	const isOwner = isOwnerRole(currentMembership?.role);

	const incompleteCount = steps.filter((s) => !s.complete).length;
	const totalSteps = steps.length;

	return (
		<div className="mb-6 flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 text-sm sm:flex-row sm:items-center sm:justify-between dark:text-amber-200">
			<div>
				<strong>
					Finish setting up {organization.name} to start running ID checks.
				</strong>{" "}
				{isOwner
					? `${incompleteCount} of ${totalSteps} onboarding steps still need attention.`
					: "An owner needs to finish the onboarding flow before this organization can run ID checks."}
			</div>
			{isOwner ? (
				<Link className="shrink-0" to="/onboarding">
					<Button type="button" variant="outline">
						Continue onboarding
					</Button>
				</Link>
			) : null}
		</div>
	);
}
