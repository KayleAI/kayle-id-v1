import { requestApiResource } from "@/utils/api-client";

export const SESSION_ANALYTICS_OVERVIEW_QUERY_KEY = [
	"dashboard",
	"session-analytics",
] as const;

export interface SessionAnalyticsSummary {
	active: number;
	cancelled: number;
	expired: number;
	failure: number;
	success: number;
	total: number;
}

export interface SessionAnalyticsTrendPoint {
	cancelled: number;
	date: string;
	expired: number;
	failure: number;
	success: number;
}

export interface SessionAnalyticsTimelinePoint {
	active: number;
	cancelled: number;
	date: string;
	expired: number;
	failure: number;
	success: number;
	total: number;
}

export interface SessionAnalyticsOverview {
	summary: SessionAnalyticsSummary;
	timeline: SessionAnalyticsTimelinePoint[];
	trend: SessionAnalyticsTrendPoint[];
}

export function getSessionAnalyticsOverview(): Promise<SessionAnalyticsOverview> {
	return requestApiResource<SessionAnalyticsOverview>({
		basePath: "/api/analytics",
		path: "/sessions/overview",
		unexpectedMessage: "Unexpected analytics response.",
	});
}
