import type { DemoWebhookEnvelope } from "@/demo/types";
import { getDemoWebhookReceiptId } from "@/demo/webhook-history";
import {
  buildDemoWebhookEventPreview,
  type DemoWebhookEventPreview,
} from "@/marketing/demo-document";

const ATTEMPT_WEBHOOK_EVENT_TYPES = new Set([
  "verification.attempt.failed",
  "verification.attempt.succeeded",
]);

export type ProcessedWebhookState = {
  decryptedPayload: string | null;
  error: string | null;
  status: "idle" | "invalid" | "verified" | "decrypted";
};

export type ProcessedWebhookMap = Record<string, ProcessedWebhookState>;

export type DemoAttemptView = {
  eventPreview: DemoWebhookEventPreview | null;
  id: string;
  processedWebhook: ProcessedWebhookState;
  receiptId: string;
  webhook: DemoWebhookEnvelope;
};

export const defaultProcessedWebhookState: ProcessedWebhookState = {
  decryptedPayload: null,
  error: null,
  status: "idle",
};

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
      processedWebhook.decryptedPayload
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
