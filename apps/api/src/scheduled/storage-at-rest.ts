import {
	resolveAnalyticsDataset,
	type resolveAnalyticsDataset as resolveAnalyticsDatasetType,
} from "@kayle-id/config/analytics-cost-events";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";
import {
	fetchD1DatabaseBytes,
	fetchKvNamespaceBytes,
	fetchR2BucketBytes,
} from "./storage-at-rest-cloudflare";
import {
	ORG_VERIFICATIONS_KV_NAMESPACE_ID,
	R2_BUCKET_NAME,
	TRUST_STORE_D1_DATABASE_ID,
} from "./storage-at-rest-config";
import { claimDailyEmissionSlot } from "./storage-at-rest-dedupe";
import {
	emitStorageBytes,
	type StorageAtRestResource,
} from "./storage-at-rest-emission";

export {
	ORG_VERIFICATIONS_KV_NAMESPACE_ID,
	R2_BUCKET_NAME,
	TRUST_STORE_D1_DATABASE_ID,
} from "./storage-at-rest-config";

type AnalyticsDataset = NonNullable<
	ReturnType<typeof resolveAnalyticsDatasetType>
>;

interface RunStorageAtRestParams {
	env: CloudflareBindings;
	now: Date;
	logger?: ApiRequestLogger;
}

interface StorageSurfaceContext {
	accountId: string;
	apiToken: string;
	dataset: AnalyticsDataset;
	logger?: ApiRequestLogger;
}

async function recordStorageSurface({
	bytes,
	errorCode,
	errorEvent,
	errorMessage,
	logger,
	logKey,
	resource,
	dataset,
}: {
	bytes: Promise<number | null>;
	errorCode: string;
	errorEvent: string;
	errorMessage: string;
	logger?: ApiRequestLogger;
	logKey: string;
	resource: StorageAtRestResource;
	dataset: AnalyticsDataset;
}): Promise<void> {
	try {
		await emitStorageBytes({
			dataset,
			bytes: await bytes,
			resource,
			logger,
			logKey,
		});
	} catch (error) {
		logSafeError(logger, {
			code: errorCode,
			error,
			event: errorEvent,
			message: errorMessage,
		});
	}
}

async function recordR2Storage({
	accountId,
	apiToken,
	dataset,
	logger,
}: StorageSurfaceContext): Promise<void> {
	await recordStorageSurface({
		dataset,
		bytes: fetchR2BucketBytes({
			accountId,
			apiToken,
			bucketName: R2_BUCKET_NAME,
		}),
		errorCode: "storage_at_rest_r2_failed",
		errorEvent: "storage_at_rest.r2_failed",
		errorMessage: "Failed to fetch R2 storage stats.",
		logger,
		logKey: `r2:${R2_BUCKET_NAME}`,
		resource: "r2_storage_byte_seconds",
	});
}

async function recordD1Storage({
	accountId,
	apiToken,
	dataset,
	logger,
}: StorageSurfaceContext): Promise<void> {
	await recordStorageSurface({
		dataset,
		bytes: fetchD1DatabaseBytes({
			accountId,
			apiToken,
			databaseId: TRUST_STORE_D1_DATABASE_ID,
		}),
		errorCode: "storage_at_rest_d1_failed",
		errorEvent: "storage_at_rest.d1_failed",
		errorMessage: "Failed to fetch D1 storage stats.",
		logger,
		logKey: `d1:${TRUST_STORE_D1_DATABASE_ID}`,
		resource: "d1_storage_byte_seconds",
	});
}

async function recordKvStorage({
	accountId,
	apiToken,
	dataset,
	logger,
}: StorageSurfaceContext): Promise<void> {
	await recordStorageSurface({
		dataset,
		bytes: fetchKvNamespaceBytes({
			accountId,
			apiToken,
			namespaceId: ORG_VERIFICATIONS_KV_NAMESPACE_ID,
		}),
		errorCode: "storage_at_rest_kv_failed",
		errorEvent: "storage_at_rest.kv_failed",
		errorMessage: "Failed to fetch KV storage stats.",
		logger,
		logKey: `kv:${ORG_VERIFICATIONS_KV_NAMESPACE_ID}`,
		resource: "kv_storage_byte_seconds",
	});
}

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

	const context = { accountId, apiToken, dataset, logger };
	await Promise.all([
		recordR2Storage(context),
		recordD1Storage(context),
		recordKvStorage(context),
	]);
}
