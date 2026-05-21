import {
	COST_EVENT_BLOB,
	COST_EVENT_DOUBLE,
	COST_EVENT_INDEX,
} from "@kayle-id/config/analytics-cost-events";
import { z } from "zod";

export const groupBySchema = z
	.enum(["feature", "resource", "day", "org", "version"])
	.default("feature");

export const querySchema = z.object({
	from: z.string().datetime().optional(),
	to: z.string().datetime().optional(),
	groupBy: groupBySchema.optional(),
});

const MAX_RANGE_DAYS = 90;
const DEFAULT_RANGE_DAYS = 30;
const MILLIS_PER_DAY = 86_400_000;

export interface AnalyticsRow {
	readonly groupKey: string;
	readonly costUsd: number;
	readonly count: number;
}

export interface CostAnalyticsResponse {
	readonly groupBy: z.infer<typeof groupBySchema>;
	readonly from: string;
	readonly to: string;
	readonly totalCostUsd: number;
	readonly rows: readonly AnalyticsRow[];
}

interface AnalyticsApiRow {
	group_key?: string | number | null;
	cost_usd?: number | string | null;
	event_count?: number | string | null;
}

export interface AnalyticsApiResponse {
	data?: AnalyticsApiRow[];
	errors?: { message?: string }[];
}

function defaultRange(): { from: Date; to: Date } {
	const to = new Date();
	const from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * MILLIS_PER_DAY);
	return { from, to };
}

export function parseRange(input: {
	from?: string;
	to?: string;
}): { from: Date; to: Date } | { error: string } {
	const defaults = defaultRange();
	const from = input.from ? new Date(input.from) : defaults.from;
	const to = input.to ? new Date(input.to) : defaults.to;
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
		return { error: "from/to must be valid ISO-8601 datetimes" };
	}
	if (from.getTime() >= to.getTime()) {
		return { error: "from must be strictly before to" };
	}
	const spanMs = to.getTime() - from.getTime();
	if (spanMs > MAX_RANGE_DAYS * MILLIS_PER_DAY) {
		return { error: `range exceeds ${MAX_RANGE_DAYS} days` };
	}
	return { from, to };
}

const GROUP_BY_COLUMN: Record<z.infer<typeof groupBySchema>, string> = {
	day: "toDate(timestamp)",
	feature: COST_EVENT_BLOB.feature,
	org: COST_EVENT_INDEX.organizationId,
	resource: COST_EVENT_BLOB.resource,
	version: COST_EVENT_BLOB.version,
};

const VALID_ENV_VALUE = /^[a-zA-Z0-9_-]+$/;

function toClickhouseTime(date: Date): string {
	return date.toISOString().replace("T", " ").slice(0, 19);
}

export function buildSql({
	groupBy,
	from,
	to,
	environment,
}: {
	groupBy: z.infer<typeof groupBySchema>;
	from: Date;
	to: Date;
	environment: string;
}): string {
	const column = GROUP_BY_COLUMN[groupBy];
	if (!VALID_ENV_VALUE.test(environment)) {
		throw new Error(`cost_analytics_invalid_environment:${environment}`);
	}

	return [
		`SELECT ${column} AS group_key, SUM(${COST_EVENT_DOUBLE.estimatedCostUsd}) AS cost_usd, COUNT() AS event_count`,
		"FROM KAYLE_ID_ANALYTICS",
		`WHERE timestamp >= toDateTime('${toClickhouseTime(from)}')`,
		`  AND timestamp < toDateTime('${toClickhouseTime(to)}')`,
		`  AND ${COST_EVENT_BLOB.environment} = '${environment}'`,
		"GROUP BY group_key",
		"ORDER BY cost_usd DESC",
		"LIMIT 1000",
	].join("\n");
}

export async function queryAnalyticsEngine({
	accountId,
	apiToken,
	sql,
}: {
	accountId: string;
	apiToken: string;
	sql: string;
}): Promise<AnalyticsApiResponse> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiToken}`,
			"Content-Type": "text/plain",
		},
		body: sql,
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`cf_analytics_http_${response.status}:${text.slice(0, 200)}`,
		);
	}
	return (await response.json()) as AnalyticsApiResponse;
}

export function toAnalyticsRows(raw: AnalyticsApiResponse): AnalyticsRow[] {
	return (raw.data ?? []).map((row) => ({
		groupKey:
			row.group_key === null || row.group_key === undefined
				? ""
				: String(row.group_key),
		costUsd: Number(row.cost_usd ?? 0),
		count: Number(row.event_count ?? 0),
	}));
}
