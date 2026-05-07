import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import {
	finalizeWebhookDeliveryFailure,
	runWebhookDeliveryAttempt,
} from "./service";
import { WEBHOOK_DELIVERY_RETRY_SCHEDULE } from "./types";

export type WebhookDeliveryWorkflowParams = {
	deliveryId: string;
};

/**
 * Run a single delivery attempt and translate any thrown failure into a
 * boolean. We can't let the throw propagate out of `step.do` here: that would
 * surface a step-level error and require the Workflow runtime to retry the
 * SAME step, but our retry cadence is driven by explicit `step.sleep` calls
 * between distinct steps so each attempt has its own checkpoint.
 */
async function attemptDelivery({
	authSecret,
	deliveryId,
}: {
	authSecret: string;
	deliveryId: string;
}): Promise<{ ok: boolean }> {
	try {
		await runWebhookDeliveryAttempt({ authSecret, deliveryId });
		return { ok: true };
	} catch {
		return { ok: false };
	}
}

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

		// Resend-style explicit cadence. We don't use `step.do`'s built-in
		// `retries.delay` + `backoff` because that's a single base-delay×N
		// formula and Resend's schedule is hand-tuned (5s, 5m, 30m, 2h, 5h,
		// 10h, 10h). Doing each attempt as its own `step.do` means each one
		// is checkpointed independently and the dashboard shows them
		// individually.
		const initial = await step.do("attempt 1 (immediate)", () =>
			attemptDelivery({ authSecret, deliveryId }),
		);
		if (initial.ok) {
			return;
		}

		for (const [index, delay] of WEBHOOK_DELIVERY_RETRY_SCHEDULE.entries()) {
			const attemptNumber = index + 2; // 1-indexed; attempt 1 was the initial
			await step.sleep(`backoff before attempt ${attemptNumber}`, delay);
			const result = await step.do(
				`attempt ${attemptNumber} (after ${delay})`,
				() => attemptDelivery({ authSecret, deliveryId }),
			);
			if (result.ok) {
				return;
			}
		}

		// Schedule exhausted — record the terminal failure on the row.
		await step.do("finalize webhook failure", async () => {
			await finalizeWebhookDeliveryFailure({ deliveryId });
		});
	}
}
