import type {
	BreakdownMetricKey,
	DisplayMetricKey,
	MetricConfig,
} from "./types";

export const DASHBOARD_SKELETON_CARD_KEYS = [
	"summary",
	"success",
	"failure",
	"expired",
	"cancelled",
] as const;

export const BREAKDOWN_METRICS: BreakdownMetricKey[] = [
	"success",
	"failure",
	"expired",
	"cancelled",
];

export const ANALYTICS_CARD_CLASS = "overflow-hidden rounded-4xl bg-background";
export const CHART_ACCENT_STROKE = "#635bff";
export const CHART_VIEWBOX_WIDTH = 336;
export const CHART_VIEWBOX_HEIGHT = 184;
export const CHART_PLOT_TOP = 16;
export const CHART_PLOT_RIGHT = 314;
export const CHART_PLOT_BOTTOM = 32;
export const CHART_PLOT_LEFT = 12;
export const CHART_Y_AXIS_LABEL_X = CHART_VIEWBOX_WIDTH - 6;

export const METRIC_CONFIG: Record<DisplayMetricKey, MetricConfig> = {
	total: {
		description: "All verification sessions created for your organization.",
		dotClassName: "bg-[#635bff]",
		label: "Total Sessions",
		stroke: "#635bff",
		title: "Total sessions",
	},
	success: {
		description: "Sessions where at least one verification attempt succeeded.",
		dotClassName: "bg-[#10b981]",
		label: "Successful",
		stroke: "#10b981",
		title: "Successful sessions",
	},
	failure: {
		description: "Completed sessions with no successful attempts.",
		dotClassName: "bg-[#f43f5e]",
		label: "Failed",
		stroke: "#f43f5e",
		title: "Failed sessions",
	},
	expired: {
		description:
			"Sessions that aged out before they reached a successful outcome.",
		dotClassName: "bg-[#f59e0b]",
		label: "Expired",
		stroke: "#f59e0b",
		title: "Expired sessions",
	},
	cancelled: {
		description: "Sessions that were actively cancelled before completion.",
		// Match the chart line `stroke` exactly so the legend dot reads as
		// the same colour in both light and dark themes (Tailwind's slate-400
		// shifts in dark mode, which made the dot drift from the line).
		dotClassName: "bg-[#94a3b8]",
		label: "Cancelled",
		stroke: "#94a3b8",
		title: "Cancelled sessions",
	},
};
