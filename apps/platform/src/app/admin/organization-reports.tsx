import { useAuth } from "@kayle-id/auth/client/provider";
import {
	ORGANIZATION_REPORT_REASONS,
	ORGANIZATION_REPORT_STATUSES,
} from "@kayle-id/config/organization-reports";
import { Badge } from "@kayle-id/ui/components/badge";
import { Button } from "@kayle-id/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kayle-id/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayle-id/ui/components/table";
import { Textarea } from "@kayle-id/ui/components/textarea";
import { cn } from "@kayle-id/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { ChevronLeftIcon, EyeIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { AppHeading } from "@/components/app-shell/heading";
import { RelativeTime } from "@/components/relative-time";
import {
	fetchOrganizationReport,
	fetchOrganizationReports,
	ORGANIZATION_REPORT_QUERY_KEY,
	ORGANIZATION_REPORTS_QUERY_KEY,
	type OrganizationReport,
	type OrganizationReportReason,
	type OrganizationReportStatus,
	updateOrganizationReport,
} from "@/lib/api/organization-reports";
import {
	ORGANIZATION_REPORT_REASON_LABELS,
	ORGANIZATION_REPORT_STATUS_LABELS,
} from "@/lib/organization-report-labels";
import { getErrorMessage } from "@/utils/get-error-message";

type ReportFilter<T extends string> = "all" | T;

const REPORT_SEARCH_DEBOUNCE_MS = 300;

export interface AdminOrganizationReportsFilters {
	query: string;
	reason: ReportFilter<OrganizationReportReason>;
	status: ReportFilter<OrganizationReportStatus>;
}

interface AdminOrganizationReportsPageProps
	extends AdminOrganizationReportsFilters {
	onFiltersChange: (filters: AdminOrganizationReportsFilters) => void;
}

const REPORT_STATUS_BADGE_CLASS: Record<OrganizationReportStatus, string> = {
	dismissed: "border-border bg-muted/40 text-muted-foreground dark:bg-muted/20",
	investigating:
		"border-blue-500/20 bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
	open: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
	resolved:
		"border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
};

function formatDate(value: string): string {
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [delayMs, value]);

	return debounced;
}

function getStatusFilterLabel(value: unknown): string {
	return typeof value === "string" && value !== "all"
		? ORGANIZATION_REPORT_STATUS_LABELS[value as OrganizationReportStatus]
		: "All statuses";
}

function getReasonFilterLabel(value: unknown): string {
	return typeof value === "string" && value !== "all"
		? ORGANIZATION_REPORT_REASON_LABELS[value as OrganizationReportReason]
		: "All reasons";
}

function ReportStatusBadge({ status }: { status: OrganizationReportStatus }) {
	return (
		<Badge
			className={cn("px-2.5 py-1 text-xs", REPORT_STATUS_BADGE_CLASS[status])}
			variant="outline"
		>
			{ORGANIZATION_REPORT_STATUS_LABELS[status]}
		</Badge>
	);
}

function OrganizationLogo({
	organization,
}: {
	organization: OrganizationReport["reported_organization"];
}) {
	const initial = organization.name.slice(0, 1).toUpperCase();

	if (organization.logo?.trim()) {
		return (
			<img
				alt=""
				className="size-10 rounded-md border border-border object-cover"
				src={organization.logo}
			/>
		);
	}

	return (
		<div
			aria-hidden="true"
			className="flex size-10 items-center justify-center rounded-md border border-border bg-muted font-medium text-sm"
		>
			{initial}
		</div>
	);
}

function ReporterContext({ context }: { context: Record<string, unknown> }) {
	const items = Object.entries(context).filter(
		([, value]) => value !== null && value !== undefined && value !== "",
	);

	if (items.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No reporter context was provided.
			</p>
		);
	}

	return (
		<dl className="grid gap-3 sm:grid-cols-2">
			{items.map(([key, value]) => (
				<div className="rounded-md border border-border/70 p-3" key={key}>
					<dt className="font-medium text-foreground text-sm">{key}</dt>
					<dd className="mt-1 break-all font-mono text-muted-foreground text-sm">
						{String(value)}
					</dd>
				</div>
			))}
		</dl>
	);
}

function ReportFilters({
	hasAnyActiveFilter,
	onClear,
	onQueryChange,
	onReasonChange,
	onStatusChange,
	query,
	reason,
	status,
}: {
	hasAnyActiveFilter: boolean;
	onClear: () => void;
	onQueryChange: (value: string) => void;
	onReasonChange: (value: ReportFilter<OrganizationReportReason>) => void;
	onStatusChange: (value: ReportFilter<OrganizationReportStatus>) => void;
	query: string;
	reason: ReportFilter<OrganizationReportReason>;
	status: ReportFilter<OrganizationReportStatus>;
}) {
	const searchId = useId();
	const statusId = useId();
	const reasonId = useId();

	return (
		<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_220px_auto] lg:items-end">
			<div className="flex flex-col gap-2">
				<Label htmlFor={searchId}>Search</Label>
				<div className="relative">
					<SearchIcon
						aria-hidden="true"
						className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
					/>
					<Input
						className="pl-9"
						id={searchId}
						name="organization-report-search"
						onChange={(event) => onQueryChange(event.target.value)}
						placeholder="Organization, slug, report ID, session, or details"
						type="search"
						value={query}
					/>
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={statusId}>Status</Label>
				<Select
					onValueChange={(value) =>
						onStatusChange(value as ReportFilter<OrganizationReportStatus>)
					}
					value={status}
				>
					<SelectTrigger
						aria-label="Filter by status"
						className="w-full"
						id={statusId}
					>
						<SelectValue>
							{(value) => (
								<span
									className={
										value === "all" ? "text-muted-foreground" : undefined
									}
								>
									{getStatusFilterLabel(value)}
								</span>
							)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						{ORGANIZATION_REPORT_STATUSES.map((value) => (
							<SelectItem key={value} value={value}>
								{ORGANIZATION_REPORT_STATUS_LABELS[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={reasonId}>Reason</Label>
				<Select
					onValueChange={(value) =>
						onReasonChange(value as ReportFilter<OrganizationReportReason>)
					}
					value={reason}
				>
					<SelectTrigger
						aria-label="Filter by reason"
						className="w-full"
						id={reasonId}
					>
						<SelectValue>
							{(value) => (
								<span
									className={
										value === "all" ? "text-muted-foreground" : undefined
									}
								>
									{getReasonFilterLabel(value)}
								</span>
							)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All reasons</SelectItem>
						{ORGANIZATION_REPORT_REASONS.map((value) => (
							<SelectItem key={value} value={value}>
								{ORGANIZATION_REPORT_REASON_LABELS[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<Button
				disabled={!hasAnyActiveFilter}
				onClick={onClear}
				type="button"
				variant="outline"
			>
				Clear
			</Button>
		</div>
	);
}

function OrganizationReportsTable({
	reports,
}: {
	reports: OrganizationReport[];
}) {
	if (reports.length === 0) {
		return (
			<div className="rounded-md border border-border border-dashed py-12 text-center text-muted-foreground text-sm">
				No reports match the current filters.
			</div>
		);
	}

	return (
		<div className="overflow-x-auto rounded-md border border-border/70">
			<Table className="w-full min-w-[900px] table-fixed">
				<colgroup>
					<col className="w-[38%]" />
					<col className="w-[24%]" />
					<col className="w-36" />
					<col className="w-44" />
					<col className="w-14" />
				</colgroup>
				<TableHeader className="bg-muted/30">
					<TableRow>
						<TableHead>Organization</TableHead>
						<TableHead>Reason</TableHead>
						<TableHead className="whitespace-nowrap">Status</TableHead>
						<TableHead>Timestamp</TableHead>
						<TableHead className="w-14 text-right">
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{reports.map((report) => (
						<TableRow key={report.id}>
							<TableCell className="align-middle">
								<Link
									className="flex min-w-0 items-center gap-3 hover:underline"
									params={{ report: report.id }}
									to="/admin/organization-reports/$report"
								>
									<OrganizationLogo
										organization={report.reported_organization}
									/>
									<span className="min-w-0">
										<span className="block truncate font-medium text-foreground text-sm">
											{report.reported_organization.name}
										</span>
										<span className="mt-0.5 block truncate text-muted-foreground text-sm">
											{report.reported_organization.slug}
										</span>
									</span>
								</Link>
							</TableCell>
							<TableCell className="align-middle">
								<Link
									className="block text-sm hover:underline"
									params={{ report: report.id }}
									to="/admin/organization-reports/$report"
								>
									{ORGANIZATION_REPORT_REASON_LABELS[report.reason]}
								</Link>
							</TableCell>
							<TableCell className="align-middle">
								<ReportStatusBadge status={report.status} />
							</TableCell>
							<TableCell className="align-middle text-muted-foreground text-sm tabular-nums">
								<RelativeTime format="absolute" iso={report.created_at} />
							</TableCell>
							<TableCell className="w-14 text-right">
								<Button
									aria-label={`View and update report for ${report.reported_organization.name}`}
									nativeButton={false}
									render={
										<Link
											params={{ report: report.id }}
											to="/admin/organization-reports/$report"
										/>
									}
									size="icon"
									variant="ghost"
								>
									<EyeIcon className="size-4" />
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function ReportDetailGrid({ report }: { report: OrganizationReport }) {
	const items = [
		{ label: "Report ID", value: report.id },
		{ label: "Organization ID", value: report.reported_organization.id },
		{
			label: "Verification session",
			value: report.verification_session_id ?? "None provided",
		},
		{ label: "Created", value: formatDate(report.created_at) },
		{ label: "Updated", value: formatDate(report.updated_at) },
		{
			label: "Resolved",
			value: report.resolved_at
				? formatDate(report.resolved_at)
				: "Not resolved",
		},
		{ label: "Resolved by", value: report.resolved_by_user_id ?? "None" },
	];

	return (
		<dl className="grid gap-3 sm:grid-cols-2">
			{items.map((item) => (
				<div
					className="rounded-md border border-border/70 p-3"
					key={item.label}
				>
					<dt className="font-medium text-foreground text-sm">{item.label}</dt>
					<dd className="mt-1 break-all text-muted-foreground text-sm">
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

function ReportStatusSelect({
	onChange,
	value,
}: {
	onChange: (value: OrganizationReportStatus) => void;
	value: OrganizationReportStatus;
}) {
	return (
		<Select
			onValueChange={(next) => onChange(next as OrganizationReportStatus)}
			value={value}
		>
			<SelectTrigger id="organization-report-status">
				<SelectValue>{(raw) => getStatusFilterLabel(raw)}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{ORGANIZATION_REPORT_STATUSES.map((nextStatus) => (
					<SelectItem key={nextStatus} value={nextStatus}>
						{ORGANIZATION_REPORT_STATUS_LABELS[nextStatus]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function usePlatformAdminGuard() {
	const { isPlatformAdmin, status } = useAuth();

	if (status === "loading") {
		return { isAllowed: false, isLoading: true } as const;
	}

	return {
		isAllowed: isPlatformAdmin,
		isLoading: false,
	} as const;
}

export function AdminOrganizationReportsPage({
	onFiltersChange,
	query,
	reason,
	status,
}: AdminOrganizationReportsPageProps) {
	const guard = usePlatformAdminGuard();
	const debouncedSearch = useDebouncedValue(query, REPORT_SEARCH_DEBOUNCE_MS);
	const activeQuery = debouncedSearch.trim();
	const reportsQuery = useQuery({
		enabled: guard.isAllowed,
		queryFn: () =>
			fetchOrganizationReports({
				query: activeQuery,
				reason,
				status,
			}),
		queryKey: [...ORGANIZATION_REPORTS_QUERY_KEY, status, reason, activeQuery],
	});

	if (guard.isLoading) {
		return null;
	}

	if (!guard.isAllowed) {
		return <Navigate to="/dashboard" />;
	}

	const reports = reportsQuery.data?.reports ?? [];
	const hasAnyActiveFilter = Boolean(
		query.trim() || status !== "open" || reason !== "all",
	);

	return (
		<div className="mx-auto flex h-full w-full max-w-7xl flex-1 grow flex-col gap-6">
			<AppHeading title="Organization reports" />
			<ReportFilters
				hasAnyActiveFilter={hasAnyActiveFilter}
				onClear={() => {
					onFiltersChange({ query: "", reason: "all", status: "open" });
				}}
				onQueryChange={(nextQuery) => {
					onFiltersChange({ query: nextQuery, reason, status });
				}}
				onReasonChange={(nextReason) => {
					onFiltersChange({ query, reason: nextReason, status });
				}}
				onStatusChange={(nextStatus) => {
					onFiltersChange({ query, reason, status: nextStatus });
				}}
				query={query}
				reason={reason}
				status={status}
			/>
			{reportsQuery.isLoading ? (
				<div className="py-12 text-center text-muted-foreground text-sm">
					Loading reports…
				</div>
			) : reportsQuery.error ? (
				<div className="py-12 text-center text-destructive text-sm">
					{getErrorMessage(
						reportsQuery.error,
						"Unable to load organization reports.",
					)}
				</div>
			) : (
				<OrganizationReportsTable reports={reports} />
			)}
		</div>
	);
}

export function AdminOrganizationReportDetailPage({
	reportId,
}: {
	reportId: string;
}) {
	const guard = usePlatformAdminGuard();
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<OrganizationReportStatus>("open");
	const [adminNote, setAdminNote] = useState("");
	const reportQuery = useQuery({
		enabled: guard.isAllowed,
		queryFn: () => fetchOrganizationReport(reportId),
		queryKey: [...ORGANIZATION_REPORT_QUERY_KEY, reportId],
	});
	const report = reportQuery.data?.report ?? null;

	useEffect(() => {
		if (!report) {
			return;
		}
		setStatus(report.status);
		setAdminNote(report.admin_note ?? "");
	}, [report]);

	const updateMutation = useMutation({
		mutationFn: () => {
			if (!report) {
				throw new Error("Organization report is not loaded.");
			}
			return updateOrganizationReport({
				admin_note: adminNote.trim() || null,
				id: report.id,
				status,
			});
		},
		onError: (error) => {
			toast.error(
				getErrorMessage(error, "Unable to update organization report."),
			);
		},
		onSuccess: async (payload) => {
			toast.success("Report updated");
			queryClient.setQueryData(
				[...ORGANIZATION_REPORT_QUERY_KEY, reportId],
				payload,
			);
			await queryClient.invalidateQueries({
				queryKey: ORGANIZATION_REPORTS_QUERY_KEY,
			});
		},
	});

	if (guard.isLoading) {
		return null;
	}

	if (!guard.isAllowed) {
		return <Navigate to="/dashboard" />;
	}

	if (reportQuery.isLoading) {
		return (
			<div className="mx-auto flex h-full w-full max-w-7xl flex-1 grow flex-col gap-6">
				<Link
					className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
					to="/admin/organization-reports"
				>
					<ChevronLeftIcon className="size-4" />
					Back to reports
				</Link>
				<div className="py-12 text-center text-muted-foreground text-sm">
					Loading report…
				</div>
			</div>
		);
	}

	if (reportQuery.error || !report) {
		return (
			<div className="mx-auto flex h-full w-full max-w-7xl flex-1 grow flex-col gap-6">
				<Link
					className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
					to="/admin/organization-reports"
				>
					<ChevronLeftIcon className="size-4" />
					Back to reports
				</Link>
				<div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm">
					{getErrorMessage(
						reportQuery.error,
						"Unable to load organization report.",
					)}
				</div>
			</div>
		);
	}

	const isDirty =
		status !== report.status || adminNote !== (report.admin_note ?? "");

	return (
		<div className="mx-auto flex h-full w-full max-w-7xl flex-1 grow flex-col gap-6">
			<Link
				className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
				to="/admin/organization-reports"
			>
				<ChevronLeftIcon className="size-4" />
				Back to reports
			</Link>

			<div className="flex flex-col gap-4 border-border/70 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
				<div className="flex min-w-0 items-center gap-4">
					<OrganizationLogo organization={report.reported_organization} />
					<div className="min-w-0">
						<h1 className="truncate font-light text-3xl tracking-tight">
							{report.reported_organization.name}
						</h1>
						<p className="mt-1 text-muted-foreground text-sm">
							{ORGANIZATION_REPORT_REASON_LABELS[report.reason]} ·{" "}
							{report.reported_organization.slug}
						</p>
					</div>
				</div>
				<ReportStatusBadge status={report.status} />
			</div>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Report details</CardTitle>
							<CardDescription>
								Reporter-submitted context and identifiers for this report.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{report.details ? (
								<div className="rounded-md border border-border/70 bg-muted/30 p-4 text-sm">
									{report.details}
								</div>
							) : (
								<p className="text-muted-foreground text-sm">
									No additional details were provided.
								</p>
							)}
							<ReportDetailGrid report={report} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Reporter context</CardTitle>
							<CardDescription>
								Metadata captured with the submitted report.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ReporterContext context={report.reporter_context} />
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Update report</CardTitle>
						<CardDescription>
							Change the review status and keep an internal admin note.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="organization-report-status">Status</Label>
							<ReportStatusSelect onChange={setStatus} value={status} />
						</div>
						<div className="space-y-2">
							<Label htmlFor="organization-report-note">Internal note</Label>
							<Textarea
								id="organization-report-note"
								maxLength={2000}
								name="admin_note"
								onChange={(event) => setAdminNote(event.target.value)}
								value={adminNote}
							/>
						</div>
						<Button
							className="w-full"
							disabled={!isDirty || updateMutation.isPending}
							onClick={() => updateMutation.mutate()}
							type="button"
						>
							{updateMutation.isPending ? "Saving…" : "Save changes"}
						</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
