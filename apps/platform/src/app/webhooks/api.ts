import { parseErrorResponse } from "@/utils/parse-error-response";
import type {
  ApiEnvelope,
  PaginatedApiEnvelope,
  Pagination,
  WebhookDelivery,
  WebhookEncryptionKey,
  WebhookEndpoint,
  WebhookEndpointCreateResult,
  WebhookEvent,
} from "./types";

export type {
  ApiError,
  DeliveryStatus,
  Pagination,
  WebhookDelivery,
  WebhookDeleteResult,
  WebhookEncryptionKey,
  WebhookEndpoint,
  WebhookEndpointCreateResult,
  WebhookEvent,
  WebhookEventDelivery,
  WebhookSigningSecretResult,
} from "./types";

export { parseJwkInput, parsePublicKeyInput } from "./jwk";

type QueryValue = boolean | number | string | null | undefined;

type RequestOptions = {
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
};

function buildQueryString(query?: Record<string, QueryValue>): string {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === "all"
    ) {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

async function requestWebhook<T>({
  body,
  method = "GET",
  path,
  query,
}: RequestOptions): Promise<T> {
  const response = await fetch(
    `/api/webhooks${path}${buildQueryString(query)}`,
    {
      method,
      credentials: "include",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorResponse(
        response,
        `Request failed with ${response.status}.`
      )
    );
  }

  const payload = (await response.json()) as ApiEnvelope<T>;

  if (payload.error || payload.data === null) {
    throw new Error(payload.error?.message ?? "Unexpected webhook response.");
  }

  return payload.data;
}

async function requestWebhookPage<T>({
  body,
  method = "GET",
  path,
  query,
}: RequestOptions): Promise<{ data: T[]; pagination: Pagination }> {
  const response = await fetch(
    `/api/webhooks${path}${buildQueryString(query)}`,
    {
      method,
      credentials: "include",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorResponse(
        response,
        `Request failed with ${response.status}.`
      )
    );
  }

  const payload = (await response.json()) as PaginatedApiEnvelope<T>;

  if (payload.error) {
    throw new Error(payload.error.message);
  }

  return {
    data: payload.data,
    pagination: payload.pagination,
  };
}

export function listWebhookEndpoints({
  enabled,
  limit = 20,
  startingAfter,
}: {
  enabled?: boolean;
  limit?: number;
  startingAfter?: string | null;
} = {}): Promise<{ data: WebhookEndpoint[]; pagination: Pagination }> {
  return requestWebhookPage<WebhookEndpoint>({
    path: "/endpoints",
    query: {
      enabled,
      limit,
      starting_after: startingAfter,
    },
  });
}

export function createWebhookEndpoint({
  enabled,
  name,
  subscribedEventTypes,
  url,
}: {
  enabled: boolean;
  name?: string | null;
  subscribedEventTypes: string[];
  url: string;
}): Promise<WebhookEndpointCreateResult> {
  return requestWebhook<WebhookEndpointCreateResult>({
    method: "POST",
    path: "/endpoints",
    body: {
      name,
      url,
      enabled,
      subscribed_event_types: subscribedEventTypes,
    },
  });
}

export function updateWebhookEndpoint({
  endpointId,
  enabled,
  name,
  subscribedEventTypes,
  url,
}: {
  endpointId: string;
  enabled: boolean;
  name?: string | null;
  subscribedEventTypes: string[];
  url: string;
}): Promise<WebhookEndpoint> {
  return requestWebhook<WebhookEndpoint>({
    method: "PATCH",
    path: `/endpoints/${endpointId}`,
    body: {
      name,
      url,
      enabled,
      subscribed_event_types: subscribedEventTypes,
    },
  });
}

export function deleteWebhookEndpoint(
  endpointId: string
): Promise<WebhookDeleteResult> {
  return requestWebhook<WebhookDeleteResult>({
    method: "DELETE",
    path: `/endpoints/${endpointId}`,
  });
}

export function revealWebhookSigningSecret(
  endpointId: string
): Promise<WebhookSigningSecretResult> {
  return requestWebhook<WebhookSigningSecretResult>({
    method: "POST",
    path: `/endpoints/${endpointId}/signing-secret/reveal`,
  });
}

export function rotateWebhookSigningSecret(
  endpointId: string
): Promise<WebhookSigningSecretResult> {
  return requestWebhook<WebhookSigningSecretResult>({
    method: "POST",
    path: `/endpoints/${endpointId}/signing-secret/rotate`,
  });
}

export function listWebhookKeys({
  endpointId,
  isActive,
  limit = 20,
  startingAfter,
}: {
  endpointId: string;
  isActive?: boolean;
  limit?: number;
  startingAfter?: string | null;
}): Promise<{ data: WebhookEncryptionKey[]; pagination: Pagination }> {
  return requestWebhookPage<WebhookEncryptionKey>({
    path: `/endpoints/${endpointId}/keys`,
    query: {
      is_active: isActive,
      limit,
      starting_after: startingAfter,
    },
  });
}

export function createWebhookKey({
  endpointId,
  jwk,
  keyId,
}: {
  endpointId: string;
  jwk: JsonWebKey;
  keyId: string;
}): Promise<WebhookEncryptionKey> {
  return requestWebhook<WebhookEncryptionKey>({
    method: "POST",
    path: `/endpoints/${endpointId}/keys`,
    body: {
      key_id: keyId,
      jwk,
      algorithm: "RSA-OAEP-256",
      key_type: "RSA",
    },
  });
}

export function deactivateWebhookKey(
  keyId: string
): Promise<WebhookEncryptionKey> {
  return requestWebhook<WebhookEncryptionKey>({
    method: "POST",
    path: `/keys/${keyId}/deactivate`,
  });
}

export function reactivateWebhookKey(
  keyId: string
): Promise<WebhookEncryptionKey> {
  return requestWebhook<WebhookEncryptionKey>({
    method: "POST",
    path: `/keys/${keyId}/reactivate`,
  });
}

export function listWebhookEvents({
  limit = 20,
  startingAfter,
}: {
  limit?: number;
  startingAfter?: string | null;
} = {}): Promise<{ data: WebhookEvent[]; pagination: Pagination }> {
  return requestWebhookPage<WebhookEvent>({
    path: "/events",
    query: {
      limit,
      starting_after: startingAfter,
    },
  });
}

export function replayWebhookEvent(eventId: string): Promise<WebhookEvent> {
  return requestWebhook<WebhookEvent>({
    method: "POST",
    path: `/events/${eventId}/replay`,
  });
}

export function listWebhookDeliveries({
  endpointId,
  limit = 20,
  startingAfter,
  status,
}: {
  endpointId?: string;
  limit?: number;
  startingAfter?: string | null;
  status?: DeliveryStatus;
} = {}): Promise<{ data: WebhookDelivery[]; pagination: Pagination }> {
  return requestWebhookPage<WebhookDelivery>({
    path: "/deliveries",
    query: {
      endpoint_id: endpointId,
      limit,
      starting_after: startingAfter,
      status,
    },
  });
}

export function retryWebhookDelivery(
  deliveryId: string
): Promise<WebhookDelivery> {
  return requestWebhook<WebhookDelivery>({
    method: "POST",
    path: `/deliveries/${deliveryId}/retry`,
  });
}
