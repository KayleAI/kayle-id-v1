import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@kayleai/ui/avatar";
import { Badge } from "@kayleai/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import { Skeleton } from "@kayleai/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RelativeTime } from "@/components/relative-time";
import {
	type FullOrganization,
	fetchFullOrganization,
	ORGANIZATION_QUERY_KEY,
} from "./api";
import { OrganizationPageLayout } from "./layout";
import { parsePublicWebsiteUrl } from "./website-url";

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
	const websiteUrl = parsePublicWebsiteUrl(organization.metadata?.website);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Identity</CardTitle>
					<CardDescription>
						This is the public identity of your organization.
					</CardDescription>
				</CardHeader>
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
							<p className="truncate text-muted-foreground text-sm">
								{organization.slug}
							</p>
							{organization.metadata?.description ? (
								<p className="mt-2 max-w-[60ch] text-pretty text-muted-foreground text-sm">
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
				<CardHeader>
					<CardTitle>Details</CardTitle>
					<CardDescription>Internal organization metadata.</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
						<div className="space-y-1">
							<dt className="font-medium text-foreground">Identifier</dt>
							<dd className="font-mono text-muted-foreground text-xs break-all">
								{organization.id}
							</dd>
						</div>
						<div className="space-y-1">
							<dt className="font-medium text-foreground">Slug</dt>
							<dd className="text-muted-foreground">{organization.slug}</dd>
						</div>
						<div className="space-y-1">
							<dt className="font-medium text-foreground">Created</dt>
							<dd className="text-muted-foreground">
								<RelativeTime iso={organization.createdAt} />
							</dd>
						</div>
						<div className="space-y-1">
							<dt className="font-medium text-foreground">Website</dt>
							<dd className="text-muted-foreground">
								{websiteUrl ? (
									<a
										className="text-foreground hover:underline"
										href={websiteUrl.href}
										rel="noopener noreferrer"
										target="_blank"
									>
										{websiteUrl.label}
									</a>
								) : (
									<span className="italic">Not set</span>
								)}
							</dd>
						</div>
					</dl>
				</CardContent>
			</Card>

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
						to="/organizations/members"
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
	const { data, isLoading, isError, error } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});

	return (
		<OrganizationPageLayout
			description="A snapshot of your organization."
			title={data?.name ?? "Organization"}
		>
			{isLoading || !data ? null : null}
			{isError ? (
				<Alert variant="destructive">
					<AlertTitle>Failed to load organization</AlertTitle>
					<AlertDescription>
						{error instanceof Error
							? error.message
							: "Something went wrong while loading this organization."}
					</AlertDescription>
				</Alert>
			) : null}
			{isLoading ? <OverviewSkeleton /> : null}
			{data && !isError ? <OverviewBody organization={data} /> : null}
		</OrganizationPageLayout>
	);
}
