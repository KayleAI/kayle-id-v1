export type ApiError = {
  code: string;
  message: string;
  hint?: string;
  docs?: string;
};

export type DeliveryStatus = "pending" | "delivering" | "succeeded" | "failed";

export type Pagination = {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};

export type ApiEnvelope<T> = {
  data: T | null;
  error: ApiError | null;
};

export type PaginatedApiEnvelope<T> = {
  data: T[];
  error: ApiError | null;
  pagination: Pagination;
};

export type WebhookEndpoint = {
  id: string;
  organization_id: string;
  name: string | null;
  url: string;
  enabled: boolean;
  subscribed_event_types: string[];
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
};

export type WebhookEndpointCreateResult = {
  endpoint: WebhookEndpoint;
  signing_secret: string;
};

export type WebhookDeleteResult = {
  message: string;
  status: "success";
};

export type WebhookSigningSecretResult = {
  endpoint_id: string;
  signing_secret: string;
};

export type WebhookEncryptionKey = {
  id: string;
  webhook_endpoint_id: string;
  key_id: string;
  algorithm: string;
  key_type: string;
  jwk: JsonWebKey;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
};

export type WebhookEventDelivery = {
  id: string;
  webhook_endpoint_id: string;
  status: DeliveryStatus;
  last_status_code: number | null;
  attempt_count: number;
  last_attempt_at: string | null;
};

export type WebhookEvent = {
  id: string;
  type: string;
  trigger_type: "verification_session" | "verification_attempt";
  trigger_id: string;
  created_at: string;
  deliveries: WebhookEventDelivery[];
};

export type WebhookDelivery = {
  id: string;
  event_id: string;
  webhook_endpoint_id: string;
  webhook_encryption_key_id: string | null;
  status: DeliveryStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};
