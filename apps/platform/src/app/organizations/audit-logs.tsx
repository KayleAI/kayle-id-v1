import { useAuth } from "@kayle-id/auth/client/provider";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Badge } from "@kayleai/ui/badge";
import { Button } from "@kayleai/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import { Skeleton } from "@kayleai/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { formatDate } from "@/utils/format-date";
import {
	type AuditLogEntry,
	fetchFullOrganization,
	listAuditLogs,
	ORGANIZATION_AUDIT_LOGS_QUERY_KEY,
	ORGANIZATION_QUERY_KEY,
	type OrganizationRole,
} from "./api";
import { OrganizationPageLayout } from "./layout";

const PAGE_SIZE = 50;

function AuditLogsSkeleton() {
	return (
		<div className="space-y-3">
			{["a", "b", "c", "d", "e"].map((key) => (
				<Skeleton className="h-12 w-full" key={key} />
			))}
		</div>
	);
}

function ActorCell({ entry }: { entry: AuditLogEntry }) {
	if (entry.actor.type === "system") {
		return (
			<span className="inline-flex items-center gap-1.5">
				<Badge variant="outline">System</Badge>
			</span>
		);
	}
	return (
		<div className="flex flex-col">
			<span className="font-medium text-sm">
				{entry.actor.name ?? "Removed user"}
			</span>
			{entry.actor.email ? (
				<span className="text-muted-foreground text-xs">
					{entry.actor.email}
				</span>
			) : null}
		</div>
	);
}

function TargetCell({ entry }: { entry: AuditLogEntry }) {
	if (!(entry.targetId || entry.targetType)) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<div className="flex flex-col">
			{entry.targetType ? (
				<span className="text-sm">{entry.targetType}</span>
			) : null}
			{entry.targetId ? (
				<span className="break-all font-mono text-muted-foreground text-xs">
					{entry.targetId}
				</span>
			) : null}
		</div>
	);
}

function MetadataCell({ entry }: { entry: AuditLogEntry }) {
	const keys = Object.keys(entry.metadata);
	if (keys.length === 0) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<dl className="grid gap-x-2 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
			{keys.map((key) => {
				const value = entry.metadata[key];
				return (
					<div className="contents" key={key}>
						<dt className="text-muted-foreground">{key}</dt>
						<dd className="break-all">
							{typeof value === "string" || typeof value === "number"
								? String(value)
								: JSON.stringify(value)}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}

function AuditLogsTable({ entries }: { entries: AuditLogEntry[] }) {
	if (entries.length === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center text-muted-foreground text-sm">
					No audit log entries yet. They appear as members and integrations make
					changes to this organization.
				</CardContent>
			</Card>
		);
	}
	return (
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Event</TableHead>
						<TableHead>Actor</TableHead>
						<TableHead>Target</TableHead>
						<TableHead>Details</TableHead>
						<TableHead className="text-right">When</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{entries.map((entry) => (
						<TableRow key={entry.id}>
							<TableCell className="align-top font-mono text-xs">
								{entry.event}
							</TableCell>
							<TableCell className="align-top">
								<ActorCell entry={entry} />
							</TableCell>
							<TableCell className="align-top">
								<TargetCell entry={entry} />
							</TableCell>
							<TableCell className="align-top">
								<MetadataCell entry={entry} />
							</TableCell>
							<TableCell className="whitespace-nowrap text-right align-top text-muted-foreground text-sm">
								{formatDate(entry.createdAt)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Card>
	);
}

export function OrganizationAuditLogsPage() {
	const { user } = useAuth();
	const orgQuery = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});

	const currentRole = orgQuery.data?.members.find(
		(member) => member.userId === user?.id,
	)?.role as OrganizationRole | undefined;
	const canView = currentRole === "owner" || currentRole === "admin";

	const auditQuery = useInfiniteQuery({
		queryKey: ORGANIZATION_AUDIT_LOGS_QUERY_KEY,
		queryFn: ({ pageParam }) =>
			listAuditLogs({
				limit: PAGE_SIZE,
				startingAfter: pageParam ?? undefined,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) =>
			lastPage.pagination.has_more ? lastPage.pagination.next_cursor : null,
		enabled: canView,
	});

	const entries = useMemo(
		() => auditQuery.data?.pages.flatMap((page) => page.data) ?? [],
		[auditQuery.data],
	);

	return (
		<OrganizationPageLayout
			description="Every state-changing action against this organization, recorded for compliance and incident review."
			title="Audit logs"
		>
			{!canView && orgQuery.data ? (
				<Card>
					<CardHeader>
						<CardTitle>Restricted</CardTitle>
						<CardDescription>
							Audit logs are visible to organization owners and admins only. Ask
							an owner or admin of this organization to share the log with you.
						</CardDescription>
					</CardHeader>
				</Card>
			) : null}

			{canView ? (
				<div className="space-y-4">
					{auditQuery.isError ? (
						<Alert variant="destructive">
							<AlertTitle>Failed to load audit logs</AlertTitle>
							<AlertDescription>
								{auditQuery.error instanceof Error
									? auditQuery.error.message
									: "Something went wrong while loading audit logs."}
							</AlertDescription>
						</Alert>
					) : null}

					{auditQuery.isLoading ? (
						<AuditLogsSkeleton />
					) : (
						<AuditLogsTable entries={entries} />
					)}

					{auditQuery.hasNextPage ? (
						<div className="flex justify-center">
							<Button
								disabled={auditQuery.isFetchingNextPage}
								onClick={() => auditQuery.fetchNextPage()}
								variant="outline"
							>
								{auditQuery.isFetchingNextPage ? "Loading..." : "Load more"}
							</Button>
						</div>
					) : null}
				</div>
			) : null}
		</OrganizationPageLayout>
	);
}
