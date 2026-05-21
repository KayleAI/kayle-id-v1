import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@kayle-id/ui/components/avatar";
import { Badge } from "@kayle-id/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { QueryErrorAlert } from "@/components/query-error-alert";
import type { FullOrganization } from "./api";
import { OrganizationPageLayout } from "./layout";
import { PendingDeletionBanner } from "./pending-deletion-banner";
import { UnverifiedOrgBanner } from "./unverified-org-banner";
import { useOrganizationQuery } from "./use-organization-query";

function OverviewSkeleton() {
	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<Skeleton className="h-5 w-32" />
				</CardHeader>
				<CardContent className="flex items-center gap-4">
					<Skeleton className="size-16 rounded-lg" />
					<div className="space-y-2">
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-24" />
					</div>
				</CardContent>
			</Card>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{["a", "b", "c"].map((key) => (
					<Card key={key}>
						<CardHeader>
							<Skeleton className="h-4 w-20" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-7 w-16" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}

function StatCard({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardHeader>
				<CardDescription className="truncate font-medium text-foreground text-sm">
					{label}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="font-medium text-2xl tabular-nums tracking-tight">
					{value}
				</p>
			</CardContent>
		</Card>
	);
}

function OverviewBody({ organization }: { organization: FullOrganization }) {
	const memberCount = organization.members.length;
	const pendingInviteCount = organization.invitations.filter(
		(invitation) => invitation.status === "pending",
	).length;
	const ownerCount = organization.members.filter(
		(member) => member.role === "owner",
	).length;

	return (
		<div className="space-y-6">
			<Card>
				<CardContent>
					<div className="flex items-center gap-4">
						<Avatar className="size-16 rounded-lg! after:rounded-lg!">
							<AvatarImage
								alt={organization.name}
								className="rounded-lg!"
								src={organization.logo ?? undefined}
							/>
							<AvatarFallback className="rounded-lg! text-lg">
								{organization.name.charAt(0).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-foreground text-lg">
								{organization.name}
							</p>
							{organization.metadata?.description ? (
								<p className="mt-1 max-w-[60ch] text-pretty text-muted-foreground text-sm">
									{organization.metadata.description}
								</p>
							) : null}
						</div>
					</div>
				</CardContent>
			</Card>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<StatCard label="Members" value={memberCount.toLocaleString()} />
				<StatCard
					label="Pending invitations"
					value={pendingInviteCount.toLocaleString()}
				/>
				<StatCard label="Owners" value={ownerCount.toLocaleString()} />
			</div>

			<Card>
				<CardHeader className="flex-row items-center justify-between gap-4">
					<div>
						<CardTitle>Recent members</CardTitle>
						<CardDescription>
							{memberCount === 0
								? "No members yet"
								: "Latest people added to this organization."}
						</CardDescription>
					</div>
					<Link
						className="font-medium text-foreground text-sm hover:underline"
						to="/settings/organizations/members"
					>
						View all
					</Link>
				</CardHeader>
				<CardContent>
					{organization.members.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Invite teammates from the Members tab.
						</p>
					) : (
						<ul className="divide-y divide-border/70">
							{organization.members.slice(0, 5).map((member) => (
								<li
									className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
									key={member.id}
								>
									<div className="flex min-w-0 items-center gap-3">
										<Avatar className="size-8 rounded-lg! after:rounded-lg!">
											<AvatarImage
												alt={member.user.name}
												className="rounded-lg!"
												src={member.user.image ?? undefined}
											/>
											<AvatarFallback className="rounded-lg! text-xs">
												{(member.user.name || member.user.email)
													.charAt(0)
													.toUpperCase()}
											</AvatarFallback>
										</Avatar>
										<div className="min-w-0">
											<p className="truncate font-medium text-foreground text-sm">
												{member.user.name || member.user.email}
											</p>
											<p className="truncate text-muted-foreground text-xs">
												{member.user.email}
											</p>
										</div>
									</div>
									<Badge variant="outline">{member.role}</Badge>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

export function OrganizationOverviewPage() {
	const { data, isLoading, isError, error } = useOrganizationQuery();

	return (
		<OrganizationPageLayout title={data?.name ?? "Organization"}>
			{data?.pendingDeletionAt ? (
				<PendingDeletionBanner pendingDeletionAt={data.pendingDeletionAt} />
			) : (
				<UnverifiedOrgBanner />
			)}
			<QueryErrorAlert
				error={isError ? error : null}
				fallback="Something went wrong while loading this organization."
				title="Failed to load organization"
			/>
			{isLoading ? <OverviewSkeleton /> : null}
			{data && !isError ? <OverviewBody organization={data} /> : null}
		</OrganizationPageLayout>
	);
}
