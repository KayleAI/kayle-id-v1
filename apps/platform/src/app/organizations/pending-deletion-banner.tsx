import { Link } from "@tanstack/react-router";
import { RelativeTime } from "@/components/relative-time";

export function PendingDeletionBanner({
	pendingDeletionAt,
}: {
	pendingDeletionAt: string;
}) {
	return (
		<div className="mb-6 flex items-center justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm">
			<div>
				<strong>Scheduled for deletion.</strong> This organization will be
				permanently deleted <RelativeTime iso={pendingDeletionAt} />. API keys,
				webhooks, and verification flows are disabled until the deletion is
				canceled.
			</div>
			<Link
				className="shrink-0 rounded-full border border-destructive/30 bg-background px-3 py-1.5 font-medium text-xs underline-offset-2 hover:underline"
				to="/settings/organizations/settings"
			>
				Cancel deletion
			</Link>
		</div>
	);
}
