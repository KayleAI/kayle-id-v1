import {
	type AnalyticsEngineDatasetLike,
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import { config } from "@/config";

const TRUST_LOADER_WORKER_NAME = "kayle-id-api";

let configuredAnalyticsDataset: AnalyticsEngineDatasetLike | null = null;

export function configurePkdTrustAnalyticsDataset(env: unknown): void {
	configuredAnalyticsDataset = resolveAnalyticsDataset(env);
}

export function clearPkdTrustAnalyticsDataset(): void {
	configuredAnalyticsDataset = null;
}

export function emitD1Read(rowCount: number): void {
	if (!configuredAnalyticsDataset || rowCount <= 0) {
		return;
	}
	emitCostEvent({
		dataset: configuredAnalyticsDataset,
		feature: COST_FEATURES.Verify,
		resource: "d1_read",
		quantity: rowCount,
		unit: "row",
		workerName: TRUST_LOADER_WORKER_NAME,
		environment: config.environment ?? "unknown",
		version: config.version,
	});
}

export function emitR2ClassB(): void {
	if (!configuredAnalyticsDataset) {
		return;
	}
	emitCostEvent({
		dataset: configuredAnalyticsDataset,
		feature: COST_FEATURES.Verify,
		resource: "r2_class_b",
		quantity: 1,
		unit: "operation",
		workerName: TRUST_LOADER_WORKER_NAME,
		environment: config.environment ?? "unknown",
		version: config.version,
	});
}
