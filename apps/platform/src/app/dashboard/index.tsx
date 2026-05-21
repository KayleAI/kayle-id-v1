import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kayle-id/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import { BarChart3Icon } from "lucide-react";
import { useState } from "react";
import { UnverifiedOrgBanner } from "@/app/organizations/unverified-org-banner";
import { AppHeading } from "@/components/app-shell/heading";
import { QueryErrorAlert } from "@/components/query-error-alert";
import {
	getSessionAnalyticsOverview,
	SESSION_ANALYTICS_OVERVIEW_QUERY_KEY,
} from "./api";
import { clampIndex, getPeriodSummary } from "./chart-utils";
import { BREAKDOWN_METRICS } from "./constants";
import { MetricTrendCard } from "./metric-trend-card";
import { DashboardSkeleton } from "./skeleton";
import { SummaryBreakdownCard } from "./summary-breakdown-card";
import type { BreakdownMetricKey } from "./types";

export function Dashboard() {
	const analyticsQuery = useQuery({
		queryFn: getSessionAnalyticsOverview,
		queryKey: SESSION_ANALYTICS_OVERVIEW_QUERY_KEY,
		staleTime: 60_000,
	});
	const [activeDate, setActiveDate] = useState<string | null>(null);
	const [activeBreakdownMetric, setActiveBreakdownMetric] =
		useState<BreakdownMetricKey | null>(null);

	const trend = analyticsQuery.data?.trend ?? [];
	const timeline = analyticsQuery.data?.timeline ?? [];
	const matchedActiveIndex = trend.findIndex(
		(point) => point.date === activeDate,
	);
	const periodSummary = getPeriodSummary(timeline);
	const isInspecting = matchedActiveIndex >= 0;
	const activeIndex = isInspecting
		? matchedActiveIndex
		: Math.max(trend.length - 1, 0);
	const isEmpty = analyticsQuery.data?.summary.total === 0;
	const shouldShowError = analyticsQuery.isError;
	const shouldShowGrid = (analyticsQuery.data?.summary.total ?? 0) > 0;
	const shouldShowLoading = analyticsQuery.isLoading && !analyticsQuery.data;

	function handleActiveIndexChange(index: number): void {
		const point = trend[clampIndex(index, trend.length)];

		if (!point) {
			return;
		}

		setActiveDate(point.date);
	}

	function handleInteractionEnd(): void {
		setActiveDate(null);
	}

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading title="Dashboard" />
			<hr className="my-4" />

			<UnverifiedOrgBanner />

			{shouldShowLoading ? <DashboardSkeleton /> : null}

			<QueryErrorAlert
				error={shouldShowError ? analyticsQuery.error : null}
				fallback="Something went wrong while loading dashboard analytics."
				title="Failed to load analytics"
			/>

			{isEmpty ? (
				<Empty className="border border-border/70 bg-muted/20">
					<EmptyMedia className="border border-border/70 bg-background">
						<BarChart3Icon className="size-5 text-muted-foreground" />
					</EmptyMedia>
					<EmptyHeader>
						<EmptyTitle>No analytics yet</EmptyTitle>
						<EmptyDescription>
							Analytics will appear here once your organization starts creating
							verification sessions.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}

			{shouldShowGrid ? (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<SummaryBreakdownCard
						activeMetric={activeBreakdownMetric}
						className="md:col-span-2"
						onActiveMetricChange={setActiveBreakdownMetric}
						summary={periodSummary}
					/>

					{BREAKDOWN_METRICS.map((metric) => (
						<MetricTrendCard
							activeIndex={activeIndex}
							data={trend}
							isInspecting={isInspecting}
							key={metric}
							metric={metric}
							onActiveIndexChange={handleActiveIndexChange}
							onInteractionEnd={handleInteractionEnd}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}
