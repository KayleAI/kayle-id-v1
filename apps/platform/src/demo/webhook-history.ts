import type { DemoWebhookEnvelope } from "@/demo/types";

type DemoWebhookHistorySource = {
  webhook?: DemoWebhookEnvelope | null;
  webhooks?: DemoWebhookEnvelope[] | null;
};

export function getDemoWebhookReceiptId(
  webhook: DemoWebhookEnvelope
): string {
  return `${webhook.delivery_id ?? ""}:${webhook.received_at}`;
}

export function getDemoWebhookHistory(
  source: DemoWebhookHistorySource | null | undefined
): DemoWebhookEnvelope[] {
  if (!source) {
    return [];
  }

  const history = Array.isArray(source.webhooks) ? source.webhooks : [];
  const latestWebhook = source.webhook ?? null;

  if (!latestWebhook) {
    return history;
  }

  if (history.length === 0) {
    return [latestWebhook];
  }

  const lastHistoricalWebhook = history.at(-1);
  if (
    lastHistoricalWebhook &&
    getDemoWebhookReceiptId(lastHistoricalWebhook) ===
      getDemoWebhookReceiptId(latestWebhook)
  ) {
    return history;
  }

  return [...history, latestWebhook];
}

export function getLatestDemoWebhook(
  source: DemoWebhookHistorySource | null | undefined
): DemoWebhookEnvelope | null {
  return getDemoWebhookHistory(source).at(-1) ?? null;
}
