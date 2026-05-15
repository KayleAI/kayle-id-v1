import { OpenAPIHono } from "@hono/zod-openapi";
import {
	COST_EVENT_BLOB,
	COST_EVENT_DOUBLE,
	COST_EVENT_INDEX,
} from "@kayle-id/config/analytics-cost-events";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { z } from "zod";
import { config } from "@/config";
import { getRequestLogger } from "@/logging";

const cost = new OpenAPIHono<{
	Bindings: CloudflareBindings;
}>();

const groupBySchema = z
	.enum(["feature", "resource", "day", "org", "version"])
	.default("feature");

const querySchema = z.object({
	from: z.string().datetime().optional(),
	to: z.string().datetime().optional(),
	groupBy: groupBySchema.optional(),
});

const MAX_RANGE_DAYS = 90;
const DEFAULT_RANGE_DAYS = 30;

interface AnalyticsRow {
	readonly groupKey: string;
	readonly costUsd: number;
	readonly count: number;
}

interface CostAnalyticsResponse {
	readonly groupBy: z.infer<typeof groupBySchema>;
	readonly from: string;
	readonly to: string;
	readonly totalCostUsd: number;
	readonly rows: readonly AnalyticsRow[];
}

function defaultRange(): { from: Date; to: Date } {
	const to = new Date();
	const from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
	return { from, to };
}

function parseRange(input: {
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
	const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
	if (spanDays > MAX_RANGE_DAYS) {
		return { error: `range exceeds ${MAX_RANGE_DAYS} days` };
	}
	return { from, to };
}

const GROUP_BY_COLUMN: Record<z.infer<typeof groupBySchema>, string> = {
	feature: COST_EVENT_BLOB.feature,
	resource: COST_EVENT_BLOB.resource,
	day: "toDate(timestamp)",
	org: COST_EVENT_INDEX.organizationId,
	version: COST_EVENT_BLOB.version,
};

/**
 * Build the Analytics Engine SQL. The environment filter is always
 * pinned to the API's own runtime environment (`config.environment`)
 * — admins can't observe or modify it. This keeps a staging dashboard
 * showing only staging spend, prod showing only prod, with zero
 * client-controllable mixing.
 */
function buildSql({
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
	const safeEnv = environment.replace(/[^a-zA-Z0-9_-]/g, "");
	return [
		`SELECT ${column} AS group_key, SUM(${COST_EVENT_DOUBLE.estimatedCostUsd}) AS cost_usd, COUNT() AS event_count`,
		"FROM KAYLE_ID_ANALYTICS",
		`WHERE timestamp >= toDateTime('${toClickhouseTime(from)}')`,
		`  AND timestamp < toDateTime('${toClickhouseTime(to)}')`,
		`  AND ${COST_EVENT_BLOB.environment} = '${safeEnv}'`,
		`GROUP BY ${column}`,
		"ORDER BY cost_usd DESC",
		"LIMIT 1000",
	].join("\n");
}

function toClickhouseTime(d: Date): string {
	// CF Analytics Engine SQL expects `YYYY-MM-DD HH:MM:SS` (UTC).
	return d.toISOString().replace("T", " ").slice(0, 19);
}

interface AnalyticsApiRow {
	group_key?: string | number | null;
	cost_usd?: number | string | null;
	event_count?: number | string | null;
}

interface AnalyticsApiResponse {
	data?: AnalyticsApiRow[];
	errors?: { message?: string }[];
}

async function queryAnalyticsEngine({
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

cost.get("/cost-analytics", async (c) => {
	const parsed = querySchema.safeParse({
		from: c.req.query("from"),
		to: c.req.query("to"),
		groupBy: c.req.query("groupBy"),
	});
	if (!parsed.success) {
		return c.json(
			{
				data: null,
				error: {
					code: "INVALID_QUERY",
					message: parsed.error.issues[0]?.message ?? "Invalid query.",
				},
			},
			400,
		);
	}

	const range = parseRange(parsed.data);
	if ("error" in range) {
		return c.json(
			{
				data: null,
				error: { code: "INVALID_RANGE", message: range.error },
			},
			400,
		);
	}

	const groupBy = parsed.data.groupBy ?? "feature";
	// Environment is server-pinned to whatever this API instance is
	// running in — never reads from the client. A staging dashboard sees
	// only staging spend; a production dashboard sees only production.
	const environment = config.environment ?? "unknown";
	const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = c.env.CLOUDFLARE_API_TOKEN;
	const logger = getRequestLogger(c);

	if (!(accountId && apiToken)) {
		logEvent(logger, {
			details: {
				error_code: "cost_analytics_config_missing",
				has_account_id: Boolean(accountId),
				has_api_token: Boolean(apiToken),
			},
			event: "admin.cost_analytics.misconfigured",
			level: "warn",
		});
		return c.json(
			{
				data: null,
				error: {
					code: "ANALYTICS_MISCONFIGURED",
					message:
						"CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be configured.",
				},
			},
			503,
		);
	}

	const sql = buildSql({
		groupBy,
		environment,
		from: range.from,
		to: range.to,
	});

	let raw: AnalyticsApiResponse;
	try {
		raw = await queryAnalyticsEngine({ accountId, apiToken, sql });
	} catch (error) {
		logSafeError(logger, {
			code: "cost_analytics_query_failed",
			error,
			event: "admin.cost_analytics.query_failed",
			message: "Analytics Engine query failed.",
			status: 502,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "ANALYTICS_QUERY_FAILED",
					message: "Analytics Engine query failed.",
				},
			},
			502,
		);
	}

	const rows: AnalyticsRow[] = (raw.data ?? []).map((row) => ({
		groupKey:
			row.group_key === null || row.group_key === undefined
				? ""
				: String(row.group_key),
		costUsd: Number(row.cost_usd ?? 0),
		count: Number(row.event_count ?? 0),
	}));

	const totalCostUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);

	const payload: CostAnalyticsResponse = {
		groupBy,
		from: range.from.toISOString(),
		to: range.to.toISOString(),
		totalCostUsd,
		rows,
	};

	// Environment goes to internal telemetry only — never to the
	// response body — so a compromised admin session can't enumerate
	// which envs exist by toggling the dashboard.
	logEvent(logger, {
		details: {
			environment,
			group_by: groupBy,
			row_count: rows.length,
			total_cost_usd: totalCostUsd,
		},
		event: "admin.cost_analytics.served",
	});

	return c.json({ data: payload, error: null });
});

export { buildSql, parseRange };
export default cost;
