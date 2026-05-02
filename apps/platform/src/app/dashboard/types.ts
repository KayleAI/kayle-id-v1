import type {
	SessionAnalyticsTimelinePoint,
	SessionAnalyticsTrendPoint,
} from "./api";

export type MetricKey = Exclude<keyof SessionAnalyticsTimelinePoint, "date">;

export type BreakdownMetricKey = Exclude<MetricKey, "active" | "total">;

export type DisplayMetricKey = BreakdownMetricKey | "total";

export type PeriodSummary = Pick<
	SessionAnalyticsTimelinePoint,
	"total" | BreakdownMetricKey
>;

export interface MetricConfig {
	description: string;
	dotClassName: string;
	label: string;
	stroke: string;
	title: string;
}

export interface ChartPoint {
	x: number;
	y: number;
}

export interface InteractiveChartSurfaceProps {
	activeIndex: number;
	ariaLabel: string;
	children: React.ReactNode;
	className?: string;
	data: SessionAnalyticsTrendPoint[];
	isInspecting: boolean;
	onActiveIndexChange: (index: number) => void;
	onInteractionEnd: () => void;
}

export interface SummaryBreakdownCardProps {
	activeMetric: BreakdownMetricKey | null;
	className?: string;
	onActiveMetricChange: (metric: BreakdownMetricKey | null) => void;
	summary: PeriodSummary;
}

export interface MetricTrendCardProps {
	activeIndex: number;
	data: SessionAnalyticsTrendPoint[];
	isInspecting: boolean;
	metric: BreakdownMetricKey;
	onActiveIndexChange: (index: number) => void;
	onInteractionEnd: () => void;
}
