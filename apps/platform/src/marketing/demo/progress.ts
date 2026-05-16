import type { DemoRunView } from "@/demo/types";
import { getDemoWebhookHistory } from "@/demo/webhook-history";

export function formatStatusLabel(value: string): string {
	return value
		.split("_")
		.map((segment) =>
			segment.length > 0
				? `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`
				: segment,
		)
		.join(" ");
}

export function getDemoProgressLabel(run: DemoRunView | null): string {
	const sessionStatus = run?.session_status ?? null;
	const latestAttempt = sessionStatus?.latest_attempt ?? null;
	const webhookCount = getDemoWebhookHistory(run).length;

	if (webhookCount > 0) {
		return `${webhookCount} webhook${webhookCount === 1 ? "" : "s"} received`;
	}

	if (latestAttempt) {
		return `Attempt ${formatStatusLabel(latestAttempt.status).toLowerCase()}`;
	}

	if (run?.session_id) {
		return "Session created, waiting for the user to start";
	}

	return "Create a session to generate the verification link";
}
