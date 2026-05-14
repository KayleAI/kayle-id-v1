// Daily storage-at-rest poller. CF bills R2/D1/KV by GB-month, but
// neither side emits per-event signals we can multiply through the rate
// card on the fly. Once a day we fetch the actual storage footprint
// from the CF API and emit byte-second events covering the elapsed
// window since the previous run (~86 400 s for a daily tick).
//
// Skipping a day costs us a day of accurate storage attribution; the
// dashboard remains correct in shape (just slightly under-counted).

import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";

const WORKER_NAME = "kayle-id-api";
const SECONDS_PER_DAY = 86_400;
const CRON_HOUR_UTC = 0;
const CRON_TICK_TOLERANCE_SEC = 90;

/**
 * Fire only on the first minute-tick of the day (00:00 UTC). The
 * verifier's cron is `* * * * *` so this guard turns each minute tick
 * into "skip" except once daily.
 */
export function shouldRunStorageAtRest(scheduledTime: number): boolean {
	const date = new Date(scheduledTime);
	if (date.getUTCHours() !== CRON_HOUR_UTC) return false;
	const seconds = date.getUTCMinutes() * 60 + date.getUTCSeconds();
	return seconds <= CRON_TICK_TOLERANCE_SEC;
}

interface CloudflareR2BucketUsage {
	end?: string;
	payloadSize?: number;
	metadataSize?: number;
}

interface CloudflareR2UsageResponse {
	success?: boolean;
	result?: CloudflareR2BucketUsage | null;
}

async function fetchR2BucketBytes({
	accountId,
	apiToken,
	bucketName,
}: {
	accountId: string;
	apiToken: string;
	bucketName: string;
}): Promise<number | null> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/usage`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiToken}` },
	});
	if (!response.ok) {
		return null;
	}
	const body = (await response
		.json()
		.catch(() => null)) as CloudflareR2UsageResponse | null;
	if (!body?.success || !body.result) {
		return null;
	}
	const payload = body.result.payloadSize ?? 0;
	const metadata = body.result.metadataSize ?? 0;
	const total = payload + metadata;
	return Number.isFinite(total) ? total : null;
}

interface RunStorageAtRestParams {
	env: CloudflareBindings;
	now: Date;
	logger?: ApiRequestLogger;
}

/**
 * Emits one cost event per storage surface representing the past 24h
 * of provisioned storage. `quantity = bytes × SECONDS_PER_DAY`; the
 * rate card converts byte-seconds → USD.
 *
 * Currently wired:
 *   - R2 STORAGE bucket (the kayle-id-r2 production bucket).
 *
 * TODO: D1 trust-store size (via `PRAGMA page_count` or CF analytics
 * API once a stable endpoint exists), KV namespace storage stats, DO
 * SQLite storage. All low-volume in current usage; safe to defer.
 */
export async function runStorageAtRestCron({
	env,
	now: _now,
	logger,
}: RunStorageAtRestParams): Promise<void> {
	const dataset = resolveAnalyticsDataset(env);
	if (!dataset) {
		return;
	}
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = env.CLOUDFLARE_API_TOKEN;
	if (!(accountId && apiToken)) {
		logEvent(logger, {
			details: {
				has_account_id: Boolean(accountId),
				has_api_token: Boolean(apiToken),
			},
			event: "storage_at_rest.misconfigured",
			level: "warn",
		});
		return;
	}

	try {
		const r2Bytes = await fetchR2BucketBytes({
			accountId,
			apiToken,
			bucketName: "kayle-id-r2",
		});
		if (r2Bytes !== null) {
			emitCostEvent({
				dataset,
				feature: COST_FEATURES.StorageCron,
				resource: "r2_storage_byte_seconds",
				quantity: r2Bytes * SECONDS_PER_DAY,
				unit: "byte_second",
				workerName: WORKER_NAME,
			});
			logEvent(logger, {
				details: { bytes: r2Bytes, bucket: "kayle-id-r2" },
				event: "storage_at_rest.r2_recorded",
			});
		}
	} catch (error) {
		logSafeError(logger, {
			code: "storage_at_rest_r2_failed",
			error,
			event: "storage_at_rest.r2_failed",
			message: "Failed to fetch R2 storage stats.",
		});
	}
}
