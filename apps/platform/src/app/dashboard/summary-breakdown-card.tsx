import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import { cn } from "@kayleai/ui/utils/cn";
import { formatMetric } from "./chart-utils";
import {
	ANALYTICS_CARD_CLASS,
	BREAKDOWN_METRICS,
	METRIC_CONFIG,
} from "./constants";
import type { SummaryBreakdownCardProps } from "./types";

export function SummaryBreakdownCard({
	activeMetric,
	className,
	onActiveMetricChange,
	summary,
}: SummaryBreakdownCardProps) {
	const total = Math.max(summary.total, 1);

	return (
		<Card className={cn(ANALYTICS_CARD_CLASS, className)}>
			<CardHeader className="space-y-2">
				<CardDescription className="font-medium text-foreground text-sm">
					Sessions in last 14 days
				</CardDescription>
				<CardTitle className="text-4xl tracking-tight">
					{formatMetric(summary.total)}
				</CardTitle>
			</CardHeader>

			<CardContent className="space-y-5">
				<div
					className="overflow-hidden rounded-full bg-muted/30"
					onPointerLeave={() => {
						onActiveMetricChange(null);
					}}
				>
					<div className="flex h-4 w-full">
						{BREAKDOWN_METRICS.map((metric) => {
							const width =
								summary[metric] === 0 ? 0 : (summary[metric] / total) * 100;

							return (
								<div
									className={cn(
										"h-full transition-opacity",
										activeMetric === null || activeMetric === metric
											? "opacity-100"
											: "opacity-80",
									)}
									key={metric}
									onPointerEnter={() => {
										onActiveMetricChange(metric);
									}}
									style={{
										backgroundColor: METRIC_CONFIG[metric].stroke,
										width: `${width}%`,
									}}
								/>
							);
						})}
					</div>
				</div>

				<div
					className="space-y-1"
					onPointerLeave={() => {
						onActiveMetricChange(null);
					}}
				>
					{BREAKDOWN_METRICS.map((metric) => {
						const config = METRIC_CONFIG[metric];
						const isActive = activeMetric === metric;

						return (
							<div
								className={cn(
									"flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors",
									isActive ? "bg-muted/35" : "hover:bg-muted/20",
								)}
								key={metric}
								onPointerEnter={() => {
									onActiveMetricChange(metric);
								}}
							>
								<span className="flex items-center gap-2 text-foreground">
									<span
										className={cn("size-2.5 rounded-full", config.dotClassName)}
									/>
									<span>{config.label}</span>
								</span>
								<span className="font-medium text-foreground tabular-nums">
									{formatMetric(summary[metric])}
								</span>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}
