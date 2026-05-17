import { z } from "zod";

export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  "verification.attempt.succeeded",
  "verification.attempt.failed",
  "verification.session.expired",
  "verification.session.cancelled",
] as const;

export const webhookEventTypeSchema = z.enum(SUPPORTED_WEBHOOK_EVENT_TYPES);

export type SupportedWebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const WEBHOOK_PAYLOAD_RETENTION_HOUR_OPTIONS = [0, 24, 72, 168] as const;

export const DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS = 72;

export const MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS = 168;

export const webhookPayloadRetentionHoursSchema = z.union([
  z.literal(0),
  z.literal(24),
  z.literal(72),
  z.literal(168),
]);
