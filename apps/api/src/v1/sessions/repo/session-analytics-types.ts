import type {
	SessionAnalyticsOutcome,
	SessionAnalyticsSummary,
} from "@/v1/analytics/session-analytics";

export type SessionAnalyticsSummaryRow = {
	count: number;
	outcome: SessionAnalyticsOutcome;
};

export type SessionAnalyticsTrendRow = {
	count: number;
	dateKey: Date | string;
	outcome: SessionAnalyticsOutcome;
};

export type SessionAnalyticsCreatedRow = {
	count: number;
	dateKey: Date | string;
};

export type SessionAnalyticsTerminalCounts = Omit<
	SessionAnalyticsSummary,
	"active" | "total"
>;
