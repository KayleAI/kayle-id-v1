import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { useMemo } from "react";
import type { DemoRunView } from "@/demo/types";
import { getDemoWebhookHistory } from "@/demo/webhook-history";
import { DemoStepPanel } from "@/marketing/demo/demo-step-panel";
import { WebhookPanel } from "@/marketing/demo/webhook-panel";
import {
	isDemoRunSettled,
	type ProcessedWebhookMap,
} from "@/marketing/demo-attempts";

export function DemoOutcomeStep({
	canReviewOutcome,
	mode = "document",
	processedWebhooks,
	run,
}: {
	canReviewOutcome: boolean;
	mode?: "age" | "document";
	processedWebhooks: ProcessedWebhookMap;
	run: DemoRunView | null;
}) {
	const sessionStatus = run?.session_status ?? null;
	const webhookHistory = useMemo(() => getDemoWebhookHistory(run), [run]);
	const isWaitingForTerminalWebhook = Boolean(
		sessionStatus?.is_terminal &&
			!isDemoRunSettled({
				processedWebhooks,
				sessionStatus,
				webhooks: webhookHistory,
			}),
	);
	const isSessionEvent =
		webhookHistory.at(-1)?.event_type?.startsWith("verification.session.") ??
		false;
	const shouldShowStepCopy = !isSessionEvent;

	return (
		<DemoStepPanel
			description={
				shouldShowStepCopy
					? mode === "age"
						? "See whether the person met the age requirement."
						: "Review the details Kayle returned for this check."
					: undefined
			}
			isLocked={!canReviewOutcome}
			stepId="step-3"
			title={
				shouldShowStepCopy
					? mode === "age"
						? "Age check result"
						: "Verified ID details"
					: undefined
			}
		>
			<div className="space-y-6">
				{isWaitingForTerminalWebhook ? (
					<Alert>
						<AlertTitle>Waiting for the webhook delivery</AlertTitle>
						<AlertDescription>
							This run has ended, but the final webhook event has not arrived
							yet. Keep this page open or restart the demo to try again.
						</AlertDescription>
					</Alert>
				) : (
					<WebhookPanel
						mode={mode}
						processedWebhooks={processedWebhooks}
						run={run}
					/>
				)}
			</div>
		</DemoStepPanel>
	);
}
