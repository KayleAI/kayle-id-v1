import { useAuth } from "@kayle-id/auth/client/provider";
import { Card, CardContent } from "@kayle-id/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppHeading } from "@/components/app-shell/heading";
import {
	COST_ANALYTICS_QUERY_KEY,
	type CostAnalyticsGroupBy,
	type CostAnalyticsResponse,
	type CostAnalyticsRow,
	fetchCostAnalytics,
} from "@/lib/api/cost-analytics";
import { getErrorMessage } from "@/utils/get-error-message";

type RangePreset = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<RangePreset, number> = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
};

const GROUP_BY_LABEL: Record<CostAnalyticsGroupBy, string> = {
	day: "Day",
	feature: "Feature",
	org: "Organization",
	resource: "Resource",
};

function rangeWindow(preset: RangePreset): { from: string; to: string } {
	const to = new Date();
	const from = new Date(to.getTime() - RANGE_DAYS[preset] * 86_400_000);
	return { from: from.toISOString(), to: to.toISOString() };
}

function formatUsd(usd: number): string {
	if (usd === 0) return "$0.00";
	if (usd < 0.01) return `$${usd.toFixed(6)}`;
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(usd);
}

function CostBarRow({ row, total }: { row: CostAnalyticsRow; total: number }) {
	const share = total > 0 ? (row.costUsd / total) * 100 : 0;
	return (
		<div className="flex items-center gap-3 py-1.5 text-sm">
			<div className="w-48 truncate font-mono text-xs" title={row.groupKey}>
				{row.groupKey || "—"}
			</div>
			<div className="flex-1">
				<div className="h-2 rounded bg-zinc-800">
					<div
						className="h-2 rounded bg-emerald-500"
						style={{ width: `${Math.min(100, share)}%` }}
					/>
				</div>
			</div>
			<div className="w-24 text-right tabular-nums">
				{formatUsd(row.costUsd)}
			</div>
			<div className="w-16 text-right text-muted-foreground text-xs tabular-nums">
				{share.toFixed(1)}%
			</div>
			<div className="w-20 text-right text-muted-foreground text-xs tabular-nums">
				{row.count.toLocaleString()}
			</div>
		</div>
	);
}

function CostBreakdownCard({
	title,
	data,
	isLoading,
	error,
}: {
	title: string;
	data: CostAnalyticsResponse | undefined;
	isLoading: boolean;
	error: unknown;
}) {
	const rows = useMemo(() => data?.rows ?? [], [data]);
	const total = data?.totalCostUsd ?? 0;

	return (
		<Card className="py-0!">
			<CardContent className="p-6">
				<div className="mb-4 flex items-baseline justify-between">
					<h3 className="font-medium text-base">{title}</h3>
					<div className="text-muted-foreground text-xs">
						{rows.length} {rows.length === 1 ? "row" : "rows"} ·{" "}
						{formatUsd(total)}
					</div>
				</div>
				{isLoading ? (
					<div className="py-8 text-center text-muted-foreground text-sm">
						Loading…
					</div>
				) : error ? (
					<div className="py-8 text-center text-destructive text-sm">
						{getErrorMessage(error, "Failed to load cost data.")}
					</div>
				) : rows.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground text-sm">
						No cost events recorded in the selected window.
					</div>
				) : (
					<div>
						<div className="flex items-center gap-3 border-b border-zinc-800 pb-2 text-muted-foreground text-xs uppercase tracking-wide">
							<div className="w-48">Key</div>
							<div className="flex-1">Share</div>
							<div className="w-24 text-right">Cost</div>
							<div className="w-16 text-right">%</div>
							<div className="w-20 text-right">Events</div>
						</div>
						{rows.map((row) => (
							<CostBarRow
								key={`${row.groupKey}-${row.costUsd}`}
								row={row}
								total={total}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function AdminCostAnalyticsPage() {
	const { isPlatformAdmin, status } = useAuth();
	const [preset, setPreset] = useState<RangePreset>("30d");

	const window = useMemo(() => rangeWindow(preset), [preset]);

	const byFeature = useQuery({
		queryKey: [...COST_ANALYTICS_QUERY_KEY, "feature", preset] as const,
		queryFn: () =>
			fetchCostAnalytics({
				groupBy: "feature",
				from: window.from,
				to: window.to,
			}),
		enabled: isPlatformAdmin,
	});

	const byResource = useQuery({
		queryKey: [...COST_ANALYTICS_QUERY_KEY, "resource", preset] as const,
		queryFn: () =>
			fetchCostAnalytics({
				groupBy: "resource",
				from: window.from,
				to: window.to,
			}),
		enabled: isPlatformAdmin,
	});

	const byDay = useQuery({
		queryKey: [...COST_ANALYTICS_QUERY_KEY, "day", preset] as const,
		queryFn: () =>
			fetchCostAnalytics({ groupBy: "day", from: window.from, to: window.to }),
		enabled: isPlatformAdmin,
	});

	const byOrg = useQuery({
		queryKey: [...COST_ANALYTICS_QUERY_KEY, "org", preset] as const,
		queryFn: () =>
			fetchCostAnalytics({ groupBy: "org", from: window.from, to: window.to }),
		enabled: isPlatformAdmin,
	});

	if (status === "loading") {
		return null;
	}

	if (!isPlatformAdmin) {
		return <Navigate to="/dashboard" />;
	}

	const totalUsd = byFeature.data?.totalCostUsd ?? 0;

	return (
		<div className="mx-auto flex h-full w-full max-w-7xl flex-1 grow flex-col gap-6">
			<AppHeading title="Cost analytics" />

			<div className="flex items-center justify-between">
				<div>
					<div className="text-muted-foreground text-xs uppercase tracking-wide">
						Estimated spend · last {RANGE_DAYS[preset]} days
					</div>
					<div className="font-semibold text-3xl tabular-nums">
						{formatUsd(totalUsd)}
					</div>
				</div>
				<div className="flex gap-1 rounded-md border border-zinc-800 p-1">
					{(Object.keys(RANGE_DAYS) as RangePreset[]).map((p) => (
						<button
							className={`rounded px-3 py-1 text-sm transition-colors ${
								p === preset
									? "bg-zinc-800 text-zinc-100"
									: "text-zinc-400 hover:text-zinc-100"
							}`}
							key={p}
							onClick={() => setPreset(p)}
							type="button"
						>
							{p}
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<CostBreakdownCard
					data={byFeature.data}
					error={byFeature.error}
					isLoading={byFeature.isLoading}
					title={`Cost by ${GROUP_BY_LABEL.feature.toLowerCase()}`}
				/>
				<CostBreakdownCard
					data={byResource.data}
					error={byResource.error}
					isLoading={byResource.isLoading}
					title={`Cost by ${GROUP_BY_LABEL.resource.toLowerCase()}`}
				/>
				<CostBreakdownCard
					data={byDay.data}
					error={byDay.error}
					isLoading={byDay.isLoading}
					title={`Cost by ${GROUP_BY_LABEL.day.toLowerCase()}`}
				/>
				<CostBreakdownCard
					data={byOrg.data}
					error={byOrg.error}
					isLoading={byOrg.isLoading}
					title={`Top orgs (${GROUP_BY_LABEL.org.toLowerCase()})`}
				/>
			</div>
		</div>
	);
}
