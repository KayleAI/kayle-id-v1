import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import { config } from "@/config";

type WebhookWorkflowEnv = {
	WEBHOOK_DELIVERY_WORKFLOW?: Workflow<{ deliveryId: string }>;
};

export async function triggerWebhookDeliveryWorkflows({
	env,
	deliveryIds,
}: {
	env: WebhookWorkflowEnv | undefined;
	deliveryIds: readonly string[];
}): Promise<void> {
	if (deliveryIds.length === 0) {
		return;
	}

	const binding = env?.WEBHOOK_DELIVERY_WORKFLOW;
	if (!binding) {
		return;
	}

	await binding.createBatch(
		deliveryIds.map((deliveryId) => ({
			params: { deliveryId },
		})),
	);

	emitCostEvent({
		dataset: resolveAnalyticsDataset(env),
		feature: COST_FEATURES.WebhookDelivery,
		resource: "workflow_run",
		quantity: deliveryIds.length,
		unit: "request",
		workerName: "kayle-id-api",
		environment: config.environment ?? "unknown",
		version: config.version,
	});
}
