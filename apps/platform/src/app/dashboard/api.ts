import { parseErrorResponse } from "@/utils/parse-error-response";

export type SessionAnalyticsSummary = {
  total: number;
  active: number;
  success: number;
  failure: number;
  expired: number;
  cancelled: number;
};

export type SessionAnalyticsTrendPoint = {
  date: string;
  success: number;
  failure: number;
  expired: number;
  cancelled: number;
};

export type SessionAnalyticsTimelinePoint = {
  date: string;
  total: number;
  active: number;
  success: number;
  failure: number;
  expired: number;
  cancelled: number;
};

export type SessionAnalyticsOverview = {
  summary: SessionAnalyticsSummary;
  trend: SessionAnalyticsTrendPoint[];
  timeline: SessionAnalyticsTimelinePoint[];
};

type ApiError = {
  code: string;
  message: string;
  hint?: string;
  docs?: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: ApiError | null;
};

async function requestAnalytics<T>(path: string): Promise<T> {
  const response = await fetch(`/api/analytics${path}`, {
    credentials: "include",
    method: "GET",
  });

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
    throw new Error(payload.error?.message ?? "Unexpected analytics response.");
  }

  return payload.data;
}

export function getSessionAnalyticsOverview(): Promise<SessionAnalyticsOverview> {
  return requestAnalytics("/sessions/overview");
}
