import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayleai/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	type FullOrganization,
	fetchFullOrganization,
	ORGANIZATION_QUERY_KEY,
} from "./api";
import { StartVerificationDialog } from "./start-verification-dialog";

function isOwnerRole(role: string | undefined): boolean {
	return role?.split(",").includes("owner") ?? false;
}

function findCurrentUserIsOwner(
	organization: FullOrganization,
	userId: string | undefined,
): boolean {
	if (!userId) {
		return false;
	}
	return organization.members.some(
		(member) => member.userId === userId && isOwnerRole(member.role),
	);
}

export function UnverifiedOrgBanner() {
	const { user } = useAuth();
	const { data } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});
	const [dialogOpen, setDialogOpen] = useState(false);

	if (!data || data.verifiedAt) {
		return null;
	}
	if (data.pendingDeletionAt) {
		return null;
	}

	const isOwner = findCurrentUserIsOwner(data, user?.id);

	return (
		<>
			<div className="mb-6 flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 text-sm sm:flex-row sm:items-center sm:justify-between dark:text-amber-200">
				<div>
					<strong>This organization is not verified.</strong>{" "}
					{isOwner
						? "Complete a one-time identity check to lift restrictions on your organization."
						: "An owner needs to complete a one-time identity check to lift restrictions on the organization."}
				</div>
				{isOwner ? (
					<Button
						className="shrink-0"
						onClick={() => setDialogOpen(true)}
						type="button"
						variant="outline"
					>
						Verify now
					</Button>
				) : null}
			</div>
			{isOwner ? (
				<StartVerificationDialog
					onOpenChange={setDialogOpen}
					open={dialogOpen}
					organization={data}
				/>
			) : null}
		</>
	);
}
