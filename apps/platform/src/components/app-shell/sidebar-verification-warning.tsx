import { Button } from "@kayle-id/ui/components/button";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { StartVerificationDialog } from "@/app/organizations/start-verification-dialog";
import {
	useCurrentMemberRole,
	useOrganizationQuery,
} from "@/app/organizations/use-organization-query";

function isOwnerRole(role: string | undefined): boolean {
	return role?.split(",").includes("owner") ?? false;
}

export function SidebarVerificationWarning() {
	const { data } = useOrganizationQuery();
	const [dialogOpen, setDialogOpen] = useState(false);
	const isOwner = isOwnerRole(useCurrentMemberRole());

	if (!data || data.verifiedAt || data.pendingDeletionAt) {
		return null;
	}

	return (
		<div className="mx-2 mb-1 group-data-[collapsible=icon]:hidden">
			<div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900 text-xs dark:text-amber-200">
				<div className="flex items-start gap-2">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
					<div className="space-y-2">
						<p>
							<strong className="font-semibold">
								Unverified organization.
							</strong>{" "}
							Verify now to lift restrictions on your organization.
						</p>
						{isOwner ? (
							<Button
								className="h-7 w-full bg-background"
								onClick={() => setDialogOpen(true)}
								size="sm"
								type="button"
								variant="outline"
							>
								Verify now
							</Button>
						) : null}
					</div>
				</div>
			</div>
			{isOwner ? (
				<StartVerificationDialog
					onOpenChange={setDialogOpen}
					open={dialogOpen}
					organization={data}
				/>
			) : null}
		</div>
	);
}
