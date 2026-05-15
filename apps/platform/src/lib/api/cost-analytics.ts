import { requestApiResource } from "@/utils/api-client";

export type CostAnalyticsGroupBy = "day" | "feature" | "org" | "resource";

export interface CostAnalyticsRow {
	groupKey: string;
	costUsd: number;
	count: number;
}

export interface CostAnalyticsResponse {
	groupBy: CostAnalyticsGroupBy;
	from: string;
	to: string;
	totalCostUsd: number;
	rows: CostAnalyticsRow[];
}

export function fetchCostAnalytics(params: {
	groupBy: CostAnalyticsGroupBy;
	from?: string;
	to?: string;
}): Promise<CostAnalyticsResponse> {
	return requestApiResource<CostAnalyticsResponse>({
		basePath: "/api/admin/cost-analytics",
		method: "GET",
		query: {
			groupBy: params.groupBy,
			from: params.from,
			to: params.to,
		},
		unexpectedMessage: "Unable to load cost analytics.",
	});
}

export const COST_ANALYTICS_QUERY_KEY = ["admin", "cost-analytics"] as const;
