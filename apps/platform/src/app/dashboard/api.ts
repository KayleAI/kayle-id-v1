import { parseErrorResponse } from "@/utils/parse-error-response";

export interface SessionAnalyticsSummary {
	active: number;
	cancelled: number;
	expired: number;
	failure: number;
	success: number;
	total: number;
}

export interface SessionAnalyticsTrendPoint {
	cancelled: number;
	date: string;
	expired: number;
	failure: number;
	success: number;
}

export interface SessionAnalyticsTimelinePoint {
	active: number;
	cancelled: number;
	date: string;
	expired: number;
	failure: number;
	success: number;
	total: number;
}

export interface SessionAnalyticsOverview {
	summary: SessionAnalyticsSummary;
	timeline: SessionAnalyticsTimelinePoint[];
	trend: SessionAnalyticsTrendPoint[];
}

interface ApiError {
	code: string;
	docs?: string;
	hint?: string;
	message: string;
}

interface ApiEnvelope<T> {
	data: T | null;
	error: ApiError | null;
}

async function requestAnalytics<T>(path: string): Promise<T> {
	const response = await fetch(`/api/analytics${path}`, {
		credentials: "include",
		method: "GET",
	});

	if (!response.ok) {
		throw new Error(
			await parseErrorResponse(
				response,
				`Request failed with ${response.status}.`,
			),
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
