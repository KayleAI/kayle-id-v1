import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import {
	buildChartPoints,
	buildLinePath,
	formatMetric,
	formatTrendPeriodLabel,
	formatTrendTick,
	formatTrendTooltipLabel,
	getMetricChartTicks,
	getMetricPeriodTotal,
} from "./chart-utils";
import {
	ANALYTICS_CARD_CLASS,
	CHART_ACCENT_STROKE,
	CHART_PLOT_BOTTOM,
	CHART_PLOT_LEFT,
	CHART_PLOT_RIGHT,
	CHART_PLOT_TOP,
	CHART_VIEWBOX_HEIGHT,
	CHART_VIEWBOX_WIDTH,
	CHART_Y_AXIS_LABEL_X,
	METRIC_CONFIG,
} from "./constants";
import { InteractiveChartSurface } from "./interactive-chart-surface";
import type { MetricTrendCardProps } from "./types";

export function MetricTrendCard({
	activeIndex,
	data,
	isInspecting,
	metric,
	onActiveIndexChange,
	onInteractionEnd,
}: MetricTrendCardProps) {
	const config = METRIC_CONFIG[metric];
	const selectedPoint = data[activeIndex];
	const periodTotal = getMetricPeriodTotal(data, metric);
	const width = CHART_VIEWBOX_WIDTH;
	const height = CHART_VIEWBOX_HEIGHT;
	const top = CHART_PLOT_TOP;
	const right = CHART_PLOT_RIGHT;
	const bottom = CHART_PLOT_BOTTOM;
	const left = CHART_PLOT_LEFT;
	const baselineY = height - bottom;
	const points = buildChartPoints({
		bottom,
		data,
		height,
		left,
		metric,
		right,
		top,
	});
	const selectedChartPoint = points[activeIndex];
	const maxValue = Math.max(1, ...data.map((point) => point[metric]));
	const yAxisTicks = getMetricChartTicks(maxValue);
	const activeX =
		data.length <= 1
			? left
			: left + ((right - left) * activeIndex) / (data.length - 1);
	const selectedDateLabel =
		isInspecting && selectedPoint
			? formatTrendTooltipLabel(selectedPoint.date)
			: formatTrendPeriodLabel(data.length);
	const displayedValue =
		isInspecting && selectedPoint ? selectedPoint[metric] : periodTotal;

	return (
		<Card className={ANALYTICS_CARD_CLASS}>
			<CardHeader className="space-y-1">
				<CardDescription className="font-medium text-foreground text-sm">
					{config.title}
				</CardDescription>
				<CardTitle className="text-4xl tracking-tight">
					{formatMetric(displayedValue)}
				</CardTitle>
				<p className="text-muted-foreground text-sm">{selectedDateLabel}</p>
			</CardHeader>

			<CardContent className="space-y-4">
				<InteractiveChartSurface
					activeIndex={activeIndex}
					ariaLabel={`${config.title} chart. Use left and right arrow keys to inspect each day.`}
					className="overflow-hidden rounded-xl border border-border/70 bg-background px-2 py-2"
					data={data}
					isInspecting={isInspecting}
					onActiveIndexChange={onActiveIndexChange}
					onInteractionEnd={onInteractionEnd}
				>
					<svg
						aria-hidden="true"
						className="h-48 w-full"
						focusable="false"
						preserveAspectRatio="none"
						viewBox={`0 0 ${width} ${height}`}
					>
						{yAxisTicks.map((tick) => {
							const y =
								top + ((maxValue - tick) / maxValue) * (baselineY - top);

							return (
								<g key={`grid-${metric}-${tick}`}>
									<line
										stroke="rgba(148, 163, 184, 0.16)"
										x1={left}
										x2={right}
										y1={y}
										y2={y}
									/>
									<text
										fill="rgba(100, 116, 139, 0.92)"
										fontSize="11"
										textAnchor="end"
										x={CHART_Y_AXIS_LABEL_X}
										y={y + 4}
									>
										{formatMetric(tick)}
									</text>
								</g>
							);
						})}

						<path
							d={buildLinePath(points)}
							fill="none"
							stroke={CHART_ACCENT_STROKE}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2.2"
						/>

						{isInspecting && selectedChartPoint ? (
							<>
								<line
									stroke="rgba(99, 91, 255, 0.16)"
									strokeDasharray="4 6"
									x1={activeX}
									x2={activeX}
									y1={top}
									y2={baselineY}
								/>
								<circle
									cx={selectedChartPoint.x}
									cy={selectedChartPoint.y}
									fill="white"
									r="4.25"
									stroke={CHART_ACCENT_STROKE}
									strokeWidth="2"
								/>
							</>
						) : null}

						<text
							fill="rgba(100, 116, 139, 0.92)"
							fontSize="11"
							textAnchor="start"
							x={left}
							y={height - 10}
						>
							{data[0] ? formatTrendTick(data[0].date) : ""}
						</text>
						<text
							fill="rgba(100, 116, 139, 0.92)"
							fontSize="11"
							textAnchor="end"
							x={right}
							y={height - 10}
						>
							{data.at(-1) ? formatTrendTick(data.at(-1)?.date ?? "") : ""}
						</text>
					</svg>
				</InteractiveChartSurface>
			</CardContent>
		</Card>
	);
}
