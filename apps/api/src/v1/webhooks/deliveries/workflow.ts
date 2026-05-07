import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import {
	finalizeWebhookDeliveryFailure,
	runWebhookDeliveryAttempt,
} from "./service";
import { MAX_DELIVERY_ATTEMPTS } from "./types";

export type WebhookDeliveryWorkflowParams = {
	deliveryId: string;
};

export class WebhookDeliveryWorkflow extends WorkflowEntrypoint<
	CloudflareBindings,
	WebhookDeliveryWorkflowParams
> {
	async run(
		event: WorkflowEvent<WebhookDeliveryWorkflowParams>,
		step: WorkflowStep,
	): Promise<void> {
		const { deliveryId } = event.payload;
		const authSecret = this.env.AUTH_SECRET;

		if (!authSecret) {
			await step.do("finalize missing auth secret", async () => {
				await finalizeWebhookDeliveryFailure({ deliveryId });
			});
			return;
		}

		try {
			await step.do(
				"deliver webhook",
				{
					retries: {
						// `limit` is the number of retries beyond the initial attempt,
						// so total attempts = limit + 1.
						limit: MAX_DELIVERY_ATTEMPTS - 1,
						delay: "1 minute",
						backoff: "exponential",
					},
					timeout: "1 minute",
				},
				async () => {
					await runWebhookDeliveryAttempt({ authSecret, deliveryId });
				},
			);
		} catch {
			// All retries exhausted — record the terminal failure on the row.
			await step.do("finalize webhook failure", async () => {
				await finalizeWebhookDeliveryFailure({ deliveryId });
			});
		}
	}
}
