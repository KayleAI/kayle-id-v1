import type { DemoSessionStatus, DemoWebhookEnvelope } from "@/demo/types";
import { getDemoWebhookReceiptId } from "@/demo/webhook-history";
import {
	buildDemoWebhookEventPreview,
	type DemoWebhookEventPreview,
} from "@/marketing/demo-document";

const ATTEMPT_WEBHOOK_EVENT_TYPES = new Set([
	"verification.attempt.failed",
	"verification.attempt.succeeded",
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
		case "completed":
			switch (sessionStatus.latest_attempt?.status) {
				case "failed":
					return "verification.attempt.failed";
				case "succeeded":
					return "verification.attempt.succeeded";
				default:
					return null;
			}
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

	const latestAttemptId = sessionStatus.latest_attempt?.id;
	if (
		expectedEventType !== "verification.session.cancelled" &&
		expectedEventType !== "verification.session.expired" &&
		!latestAttemptId
	) {
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

		if (eventPreview.verificationSessionId !== sessionStatus.session_id) {
			return false;
		}

		if (
			expectedEventType === "verification.session.cancelled" ||
			expectedEventType === "verification.session.expired"
		) {
			return true;
		}

		return eventPreview.verificationAttemptId === latestAttemptId;
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
		const attemptId = eventPreview?.verificationAttemptId ?? receiptId;

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
