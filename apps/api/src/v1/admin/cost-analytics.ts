import { OpenAPIHono } from "@hono/zod-openapi";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { config } from "@/config";
import { getRequestLogger } from "@/logging";
import {
	type AnalyticsApiResponse,
	buildSql,
	type CostAnalyticsResponse,
	parseRange,
	queryAnalyticsEngine,
	querySchema,
	toAnalyticsRows,
} from "./cost-analytics-query";

type AdminContextVariables = {
	userId: string;
	organizationId: string;
};

const cost = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: AdminContextVariables;
}>();

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
			details: {
				underlying_message:
					error instanceof Error ? error.message : String(error),
			},
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

	const rows = toAnalyticsRows(raw);
	const totalCostUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);

	const payload: CostAnalyticsResponse = {
		groupBy,
		from: range.from.toISOString(),
		to: range.to.toISOString(),
		totalCostUsd,
		rows,
	};

	logEvent(logger, {
		details: {
			actor_user_id: c.get("userId") ?? null,
			actor_organization_id: c.get("organizationId") ?? null,
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
