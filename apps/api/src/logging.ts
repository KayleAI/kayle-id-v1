import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import {
	createSafeRequestLogger,
	emitSafeRequestLog,
	getSafeErrorStatus,
	initStructuredLogger,
	logSafeError,
	type SafeRequestLogger,
} from "@kayle-id/config/logging";
import type { Context, MiddlewareHandler } from "hono";
import { config } from "@/config";

const WORKER_NAME = "kayle-id-api";

const REQUEST_LOG_KEY = "log";
const REQUEST_LOG_EMITTED_KEY = "request_log_emitted";
const REQUEST_LOG_MANUAL_EMIT_KEY = "request_log_manual_emit";

type ApiLoggingVariables = {
	log: SafeRequestLogger;
	request_log_emitted: boolean;
	request_log_manual_emit: boolean;
};

type ApiLoggingContext = Context<{
	Variables: ApiLoggingVariables;
}>;

interface RequestLoggingMiddlewareOptions {
	emitRequestLogs?: boolean;
}

initStructuredLogger({
	environment: config.environment,
	service: "kayle-id-api",
	version: config.version,
});

function getLoggingContext(c: Context): ApiLoggingContext {
	return c as ApiLoggingContext;
}

export type ApiRequestLogger = SafeRequestLogger;

export function emitRequestLog(
	c: Context,
	status: number,
): ReturnType<SafeRequestLogger["emit"]> {
	const loggingContext = getLoggingContext(c);

	if (loggingContext.get(REQUEST_LOG_EMITTED_KEY)) {
		return null;
	}

	const emitted = emitSafeRequestLog(
		loggingContext.get(REQUEST_LOG_KEY),
		status,
	);
	loggingContext.set(REQUEST_LOG_EMITTED_KEY, true);
	return emitted;
}

export function getRequestLogger(c: Context): ApiRequestLogger {
	return getLoggingContext(c).get(REQUEST_LOG_KEY);
}

export function markRequestLogForManualEmit(c: Context): void {
	getLoggingContext(c).set(REQUEST_LOG_MANUAL_EMIT_KEY, true);
}

function emitRequestCostEvents(c: Context, startedAtMs: number): void {
	const env = (c as unknown as { env: unknown }).env;
	const dataset = resolveAnalyticsDataset(env);
	if (!dataset) {
		return;
	}
	const organizationId = c.get("organizationId" as never) as string | undefined;
	const durationMs = Math.max(0, Date.now() - startedAtMs);
	const environment = config.environment ?? "unknown";
	emitCostEvent({
		dataset,
		organizationId,
		feature: COST_FEATURES.Unknown,
		resource: "worker_request",
		quantity: 1,
		unit: "request",
		workerName: WORKER_NAME,
		environment,
		version: config.version,
	});
	// Wall-clock duration is a rough proxy for billable CPU-ms — it
	// includes I/O wait. Treat the resulting cost as an upper bound;
	// CF only charges for active CPU.
	emitCostEvent({
		dataset,
		organizationId,
		feature: COST_FEATURES.Unknown,
		resource: "worker_cpu",
		quantity: durationMs,
		unit: "ms",
		workerName: WORKER_NAME,
		environment,
		version: config.version,
	});
}

export function requestLoggingMiddleware({
	emitRequestLogs = process.env.NODE_ENV !== "test",
}: RequestLoggingMiddlewareOptions = {}): MiddlewareHandler {
	return async (c, next) => {
		const loggingContext = getLoggingContext(c);
		const existingLogger = loggingContext.get(REQUEST_LOG_KEY);

		if (existingLogger) {
			await next();
			return;
		}

		const logger = createSafeRequestLogger(c.req.raw);
		const startedAt = Date.now();

		loggingContext.set(REQUEST_LOG_KEY, logger);
		loggingContext.set(REQUEST_LOG_EMITTED_KEY, false);
		loggingContext.set(REQUEST_LOG_MANUAL_EMIT_KEY, false);

		try {
			await next();

			if (loggingContext.get(REQUEST_LOG_MANUAL_EMIT_KEY)) {
				return;
			}

			if (emitRequestLogs) {
				emitRequestLog(c, c.res.status);
				emitRequestCostEvents(c, startedAt);
			}
		} catch (error) {
			const status = getSafeErrorStatus(error) ?? 500;

			logSafeError(logger, {
				code: "request_failed",
				error,
				event: "request_failed",
				message: "The request failed before a response was returned.",
				status,
			});
			if (emitRequestLogs) {
				emitRequestLog(c, status);
				emitRequestCostEvents(c, startedAt);
			}
			throw error;
		}
	};
}
