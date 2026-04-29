import type {
	SessionAnalyticsTimelinePoint,
	SessionAnalyticsTrendPoint,
} from "./api";
import {
	CHART_PLOT_LEFT,
	CHART_PLOT_RIGHT,
	CHART_VIEWBOX_WIDTH,
} from "./constants";
import type { BreakdownMetricKey, ChartPoint, PeriodSummary } from "./types";

export function formatMetric(value: number): string {
	return value.toLocaleString();
}

export function formatTrendTick(value: string): string {
	return new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "short",
	}).format(new Date(`${value}T00:00:00.000Z`));
}

export function formatTrendTooltipLabel(value: string): string {
	return new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(`${value}T00:00:00.000Z`));
}

export function formatTrendPeriodLabel(dayCount: number): string {
	if (dayCount <= 0) {
		return "No analytics yet";
	}

	return `Last ${dayCount} day${dayCount === 1 ? "" : "s"}`;
}

function createEmptyPeriodSummary(): PeriodSummary {
	return {
		cancelled: 0,
		expired: 0,
		failure: 0,
		success: 0,
		total: 0,
	};
}

export function clampIndex(index: number, count: number): number {
	if (count <= 1) {
		return 0;
	}

	return Math.max(0, Math.min(count - 1, index));
}

export function resolveIndexFromClientX(
	clientX: number,
	rect: DOMRect,
	count: number,
): number {
	if (count <= 1) {
		return 0;
	}

	const chartLeft = (CHART_PLOT_LEFT / CHART_VIEWBOX_WIDTH) * rect.width;
	const chartRight = (CHART_PLOT_RIGHT / CHART_VIEWBOX_WIDTH) * rect.width;
	const clampedX = Math.max(
		chartLeft,
		Math.min(chartRight, clientX - rect.left),
	);
	const ratio =
		chartRight === chartLeft
			? 0
			: (clampedX - chartLeft) / (chartRight - chartLeft);
	return clampIndex(Math.round(ratio * (count - 1)), count);
}

export function buildChartPoints({
	bottom,
	data,
	height,
	left,
	metric,
	right,
	top,
}: {
	bottom: number;
	data: SessionAnalyticsTrendPoint[];
	height: number;
	left: number;
	metric: BreakdownMetricKey;
	right: number;
	top: number;
}): ChartPoint[] {
	const maxValue = Math.max(1, ...data.map((point) => point[metric]));
	const innerHeight = height - top - bottom;
	const innerWidth = right - left;

	return data.map((point, index) => {
		const x =
			data.length === 1
				? left
				: left + (innerWidth * index) / (data.length - 1);
		const y = top + innerHeight - (point[metric] / maxValue) * innerHeight;

		return {
			x,
			y,
		};
	});
}

export function buildLinePath(points: ChartPoint[]): string {
	if (points.length === 0) {
		return "";
	}

	return points
		.map(
			(point, index) =>
				`${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
		)
		.join(" ");
}

export function getMetricChartTicks(maxValue: number): number[] {
	if (maxValue <= 1) {
		return [1, 0];
	}

	return [maxValue, Math.round(maxValue / 2), 0];
}

export function getMetricPeriodTotal(
	data: SessionAnalyticsTrendPoint[],
	metric: BreakdownMetricKey,
): number {
	let total = 0;

	for (const point of data) {
		total += point[metric];
	}

	return total;
}

export function getPeriodSummary(
	timeline: SessionAnalyticsTimelinePoint[],
): PeriodSummary {
	const latestPoint = timeline.at(-1);

	if (!latestPoint) {
		return createEmptyPeriodSummary();
	}

	return {
		cancelled: latestPoint.cancelled,
		expired: latestPoint.expired,
		failure: latestPoint.failure,
		success: latestPoint.success,
		total: latestPoint.total,
	};
}
