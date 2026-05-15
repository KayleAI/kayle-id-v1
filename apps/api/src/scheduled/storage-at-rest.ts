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
import { config } from "@/config";
import type { ApiRequestLogger } from "@/logging";

const WORKER_NAME = "kayle-id-api";
const SECONDS_PER_DAY = 86_400;

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

interface CloudflareD1DatabaseInfo {
	file_size?: number;
	num_tables?: number;
}

interface CloudflareD1DatabaseResponse {
	success?: boolean;
	result?: CloudflareD1DatabaseInfo | null;
}

async function fetchD1DatabaseBytes({
	accountId,
	apiToken,
	databaseId,
}: {
	accountId: string;
	apiToken: string;
	databaseId: string;
}): Promise<number | null> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiToken}` },
	});
	if (!response.ok) {
		return null;
	}
	const body = (await response
		.json()
		.catch(() => null)) as CloudflareD1DatabaseResponse | null;
	const size = body?.success ? body.result?.file_size : undefined;
	return typeof size === "number" && Number.isFinite(size) ? size : null;
}

interface CloudflareKvNamespaceInfo {
	id?: string;
	title?: string;
	storage_bytes?: number;
}

interface CloudflareKvResultInfo {
	page?: number;
	per_page?: number;
	count?: number;
	total_count?: number;
	total_pages?: number;
}

interface CloudflareKvNamespacesResponse {
	success?: boolean;
	result?: CloudflareKvNamespaceInfo[];
	result_info?: CloudflareKvResultInfo;
}

// Hard ceiling on pages we'll walk. CF's per_page max is 100; with a
// 50-page cap we cover up to 5_000 namespaces — well above any
// realistic Kayle ID account — without risking a runaway loop if the
// API returns an off-by-one `total_pages`.
const KV_NAMESPACE_PAGE_LIMIT = 50;

async function fetchKvNamespaceBytes({
	accountId,
	apiToken,
	namespaceId,
}: {
	accountId: string;
	apiToken: string;
	namespaceId: string;
}): Promise<number | null> {
	// CF's per-namespace endpoint doesn't expose storage_bytes directly,
	// but the list endpoint does. Walk pages until we hit the target id;
	// `?per_page=100` is the CF max so this is at most ceil(N / 100)
	// round-trips, bounded by KV_NAMESPACE_PAGE_LIMIT.
	for (let page = 1; page <= KV_NAMESPACE_PAGE_LIMIT; page += 1) {
		const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=${page}`;
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${apiToken}` },
		});
		if (!response.ok) {
			return null;
		}
		const body = (await response
			.json()
			.catch(() => null)) as CloudflareKvNamespacesResponse | null;
		if (!body?.success || !Array.isArray(body.result)) {
			return null;
		}
		const match = body.result.find((entry) => entry.id === namespaceId);
		if (match) {
			const bytes = match.storage_bytes;
			return typeof bytes === "number" && Number.isFinite(bytes) ? bytes : null;
		}
		const totalPages = body.result_info?.total_pages;
		const exhausted =
			(typeof totalPages === "number" && page >= totalPages) ||
			body.result.length === 0;
		if (exhausted) {
			return null;
		}
	}
	return null;
}

interface RunStorageAtRestParams {
	env: CloudflareBindings;
	now: Date;
	logger?: ApiRequestLogger;
}

// Wrangler-config IDs — keep these in sync with apps/api/wrangler.jsonc.
// `storage-at-rest-config.test.ts` asserts these match the binding ids
// declared in wrangler.jsonc so a future rename can't drift silently.
export const TRUST_STORE_D1_DATABASE_ID =
	"268b1f9b-d31b-452e-8b2a-567e45fd3f05";
export const ORG_VERIFICATIONS_KV_NAMESPACE_ID =
	"3cacbcba5de84a1395b328d04f2e9376";
export const R2_BUCKET_NAME = "kayle-id-r2";

function formatRunDay(now: Date): string {
	const year = now.getUTCFullYear().toString().padStart(4, "0");
	const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
	const day = now.getUTCDate().toString().padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function isMissingDedupeTableError(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	return message.toLowerCase().includes("no such table");
}

/**
 * Insert today's `run_day` into `storage_at_rest_runs`. Returns
 * `true` iff this invocation owns today's slot. Fails closed on D1
 * errors — a duplicate emission would distort the dashboard for 24h.
 * Migration drift surfaces as the distinct `dedupe_table_missing`
 * event so operators can tell it apart from a transient D1 hiccup.
 */
async function claimDailyEmissionSlot({
	env,
	now,
	logger,
}: {
	env: CloudflareBindings;
	now: Date;
	logger?: ApiRequestLogger;
}): Promise<boolean> {
	const runDay = formatRunDay(now);
	try {
		const result = await env.TRUST_STORE.prepare(
			"INSERT INTO storage_at_rest_runs (run_day, completed_at_ms) VALUES (?, ?) ON CONFLICT(run_day) DO NOTHING",
		)
			.bind(runDay, now.getTime())
			.run();
		const inserted = (result.meta?.changes ?? 0) > 0;
		if (!inserted) {
			logEvent(logger, {
				details: { run_day: runDay },
				event: "storage_at_rest.skipped_already_ran",
			});
		}
		return inserted;
	} catch (error) {
		if (isMissingDedupeTableError(error)) {
			logSafeError(logger, {
				code: "storage_at_rest_dedupe_table_missing",
				details: { run_day: runDay },
				error,
				event: "storage_at_rest.dedupe_table_missing",
				message:
					"storage_at_rest_runs table is missing — apply migration 0002_storage_at_rest_runs.sql to this env.",
			});
			return false;
		}
		logSafeError(logger, {
			code: "storage_at_rest_dedupe_failed",
			details: { run_day: runDay },
			error,
			event: "storage_at_rest.dedupe_failed",
			message:
				"storage-at-rest dedupe insert failed; skipping emission to avoid duplicate counting.",
		});
		return false;
	}
}

async function emitStorageBytes({
	dataset,
	bytes,
	resource,
	logger,
	logKey,
}: {
	dataset: ReturnType<typeof resolveAnalyticsDataset>;
	bytes: number | null;
	resource:
		| "r2_storage_byte_seconds"
		| "d1_storage_byte_seconds"
		| "kv_storage_byte_seconds";
	logger?: ApiRequestLogger;
	logKey: string;
}): Promise<void> {
	if (bytes === null || !dataset) {
		return;
	}
	emitCostEvent({
		dataset,
		feature: COST_FEATURES.StorageCron,
		resource,
		quantity: bytes * SECONDS_PER_DAY,
		unit: "byte_second",
		workerName: WORKER_NAME,
		environment: config.environment ?? "unknown",
		version: config.version,
	});
	logEvent(logger, {
		details: { bytes, key: logKey },
		event: "storage_at_rest.recorded",
	});
}

/**
 * Emits one cost event per storage surface representing the past 24h
 * of provisioned storage. `quantity = bytes × SECONDS_PER_DAY`; the
 * rate card converts byte-seconds → USD.
 *
 * Wired surfaces:
 *   - R2 STORAGE bucket (kayle-id-r2).
 *   - D1 TRUST_STORE database (kayle-id-trust-store).
 *   - KV ORG_VERIFICATIONS_KV namespace.
 *
 * Each fetch is independent; a partial failure doesn't block the
 * others. Each surface is logged on success for debug visibility.
 */
export async function runStorageAtRestCron({
	env,
	now,
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

	const ownsToday = await claimDailyEmissionSlot({ env, now, logger });
	if (!ownsToday) {
		return;
	}

	const tasks: Array<Promise<unknown>> = [
		(async () => {
			try {
				const bytes = await fetchR2BucketBytes({
					accountId,
					apiToken,
					bucketName: R2_BUCKET_NAME,
				});
				await emitStorageBytes({
					dataset,
					bytes,
					resource: "r2_storage_byte_seconds",
					logger,
					logKey: `r2:${R2_BUCKET_NAME}`,
				});
			} catch (error) {
				logSafeError(logger, {
					code: "storage_at_rest_r2_failed",
					error,
					event: "storage_at_rest.r2_failed",
					message: "Failed to fetch R2 storage stats.",
				});
			}
		})(),
		(async () => {
			try {
				const bytes = await fetchD1DatabaseBytes({
					accountId,
					apiToken,
					databaseId: TRUST_STORE_D1_DATABASE_ID,
				});
				await emitStorageBytes({
					dataset,
					bytes,
					resource: "d1_storage_byte_seconds",
					logger,
					logKey: `d1:${TRUST_STORE_D1_DATABASE_ID}`,
				});
			} catch (error) {
				logSafeError(logger, {
					code: "storage_at_rest_d1_failed",
					error,
					event: "storage_at_rest.d1_failed",
					message: "Failed to fetch D1 storage stats.",
				});
			}
		})(),
		(async () => {
			try {
				const bytes = await fetchKvNamespaceBytes({
					accountId,
					apiToken,
					namespaceId: ORG_VERIFICATIONS_KV_NAMESPACE_ID,
				});
				await emitStorageBytes({
					dataset,
					bytes,
					resource: "kv_storage_byte_seconds",
					logger,
					logKey: `kv:${ORG_VERIFICATIONS_KV_NAMESPACE_ID}`,
				});
			} catch (error) {
				logSafeError(logger, {
					code: "storage_at_rest_kv_failed",
					error,
					event: "storage_at_rest.kv_failed",
					message: "Failed to fetch KV storage stats.",
				});
			}
		})(),
	];

	await Promise.all(tasks);
}
