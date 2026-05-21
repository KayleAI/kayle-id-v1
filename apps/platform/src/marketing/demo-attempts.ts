import type { DemoSessionStatus, DemoWebhookEnvelope } from "@/demo/types";
import { getDemoWebhookReceiptId } from "@/demo/webhook-history";
import {
	buildDemoWebhookEventPreview,
	type DemoWebhookEventPreview,
} from "@/marketing/demo-document";

const ATTEMPT_WEBHOOK_EVENT_TYPES = new Set([
	"verification.session.failed",
	"verification.session.succeeded",
]);

export interface ProcessedWebhookState {
	decryptedPayload: string | null;
	error: string | null;
	status: "idle" | "invalid" | "verified" | "decrypted";
}

export type ProcessedWebhookMap = Record<string, ProcessedWebhookState>;

export interface DemoAttemptView {
	eventPreview: DemoWebhookEventPreview | null;
	id: string;
	processedWebhook: ProcessedWebhookState;
	receiptId: string;
	webhook: DemoWebhookEnvelope;
}

export const defaultProcessedWebhookState: ProcessedWebhookState = {
	decryptedPayload: null,
	error: null,
	status: "idle",
};

function getExpectedTerminalEventType(
	sessionStatus: DemoSessionStatus,
): DemoWebhookEnvelope["event_type"] {
	switch (sessionStatus.status) {
		case "cancelled":
			return "verification.session.cancelled";
		case "expired":
			return "verification.session.expired";
		case "succeeded":
			return "verification.session.succeeded";
		case "failed":
			return "verification.session.failed";
		default:
			return null;
	}
}

function getAcceptedWebhookEventPreview({
	processedWebhooks,
	webhook,
}: {
	processedWebhooks: ProcessedWebhookMap;
	webhook: DemoWebhookEnvelope;
}): DemoWebhookEventPreview | null {
	const processedWebhook =
		processedWebhooks[getDemoWebhookReceiptId(webhook)] ??
		defaultProcessedWebhookState;
	if (processedWebhook.status !== "decrypted") {
		return null;
	}

	return buildDemoWebhookEventPreview(processedWebhook.decryptedPayload);
}

export function isDemoRunSettled({
	processedWebhooks,
	sessionStatus,
	webhooks,
}: {
	processedWebhooks: ProcessedWebhookMap;
	sessionStatus: DemoSessionStatus | null | undefined;
	webhooks: DemoWebhookEnvelope[];
}): boolean {
	if (!sessionStatus?.is_terminal) {
		return false;
	}

	const expectedEventType = getExpectedTerminalEventType(sessionStatus);
	if (!expectedEventType) {
		return false;
	}

	return webhooks.some((webhook) => {
		if (webhook.event_type !== expectedEventType) {
			return false;
		}

		const eventPreview = getAcceptedWebhookEventPreview({
			processedWebhooks,
			webhook,
		});
		if (!(eventPreview?.eventType === expectedEventType)) {
			return false;
		}

		return eventPreview.verificationSessionId === sessionStatus.session_id;
	});
}

export function buildDemoAttemptViews({
	processedWebhooks,
	webhooks,
}: {
	processedWebhooks: ProcessedWebhookMap;
	webhooks: DemoWebhookEnvelope[];
}): DemoAttemptView[] {
	const orderedAttemptIds: string[] = [];
	const attemptsById = new Map<string, DemoAttemptView>();

	for (const webhook of webhooks) {
		if (!ATTEMPT_WEBHOOK_EVENT_TYPES.has(webhook.event_type ?? "")) {
			continue;
		}

		const receiptId = getDemoWebhookReceiptId(webhook);
		const processedWebhook =
			processedWebhooks[receiptId] ?? defaultProcessedWebhookState;
		const eventPreview = buildDemoWebhookEventPreview(
			processedWebhook.decryptedPayload,
		);
		const attemptId = eventPreview?.verificationSessionId ?? receiptId;

		if (!attemptsById.has(attemptId)) {
			orderedAttemptIds.push(attemptId);
		}

		attemptsById.set(attemptId, {
			eventPreview,
			id: attemptId,
			processedWebhook,
			receiptId,
			webhook,
		});
	}

	return orderedAttemptIds.flatMap((attemptId) => {
		const attempt = attemptsById.get(attemptId);
		return attempt ? [attempt] : [];
	});
}
