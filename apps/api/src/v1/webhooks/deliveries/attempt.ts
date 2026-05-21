import { finalizeWebhookDeliveryFailure } from "./attempt-finalize";
import { runWebhookDeliveryAttempt } from "./attempt-runner";
import { getMappedWebhookDelivery } from "./repository";
import type { DeliveryRowResponse } from "./types";

export { finalizeWebhookDeliveryFailure, runWebhookDeliveryAttempt };

export async function attemptWebhookDelivery({
	authSecret,
	deliveryId,
}: {
	authSecret: string;
	deliveryId: string;
}): Promise<DeliveryRowResponse | null> {
	try {
		await runWebhookDeliveryAttempt({ authSecret, deliveryId });
	} catch {}

	return getMappedWebhookDelivery(deliveryId);
}
