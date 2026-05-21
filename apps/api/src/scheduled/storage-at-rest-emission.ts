import {
	COST_FEATURES,
	emitCostEvent,
	type resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import { logEvent } from "@kayle-id/config/logging";
import { config } from "@/config";
import type { ApiRequestLogger } from "@/logging";
import {
	SECONDS_PER_DAY,
	STORAGE_AT_REST_WORKER_NAME,
} from "./storage-at-rest-config";

export type StorageAtRestResource =
	| "d1_storage_byte_seconds"
	| "kv_storage_byte_seconds"
	| "r2_storage_byte_seconds";

export async function emitStorageBytes({
	dataset,
	bytes,
	resource,
	logger,
	logKey,
}: {
	dataset: ReturnType<typeof resolveAnalyticsDataset>;
	bytes: number | null;
	resource: StorageAtRestResource;
	logger?: ApiRequestLogger;
	logKey: string;
}): Promise<void> {
	if (bytes === null || !dataset) {
		return;
	}

	emitCostEvent({
		dataset,
		environment: config.environment ?? "unknown",
		feature: COST_FEATURES.StorageCron,
		quantity: bytes * SECONDS_PER_DAY,
		resource,
		unit: "byte_second",
		version: config.version,
		workerName: STORAGE_AT_REST_WORKER_NAME,
	});
	logEvent(logger, {
		details: { bytes, key: logKey },
		event: "storage_at_rest.recorded",
	});
}
