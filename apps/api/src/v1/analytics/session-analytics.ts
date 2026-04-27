export type SessionAnalyticsOutcome =
	| "active"
	| "cancelled"
	| "expired"
	| "failure"
	| "success";

export type TerminalSessionAnalyticsOutcome = Exclude<
	SessionAnalyticsOutcome,
	"active"
>;

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

export const SESSION_ANALYTICS_TREND_DAYS = 14;
const UTC_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function createEmptySessionAnalyticsSummary(): SessionAnalyticsSummary {
	return {
		total: 0,
		active: 0,
		success: 0,
		failure: 0,
		expired: 0,
		cancelled: 0,
	};
}

export function createZeroFilledSessionAnalyticsTrend({
	days = SESSION_ANALYTICS_TREND_DAYS,
	now = new Date(),
}: {
	days?: number;
	now?: Date;
} = {}): SessionAnalyticsTrendPoint[] {
	const trend: SessionAnalyticsTrendPoint[] = [];
	const end = getUtcStartOfDay(now);

	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const date = addUtcDays(end, -offset);
		trend.push({
			cancelled: 0,
			date: formatUtcDateKey(date),
			expired: 0,
			failure: 0,
			success: 0,
		});
	}

	return trend;
}

export function createZeroFilledSessionAnalyticsTimeline({
	days = SESSION_ANALYTICS_TREND_DAYS,
	now = new Date(),
}: {
	days?: number;
	now?: Date;
} = {}): SessionAnalyticsTimelinePoint[] {
	const timeline: SessionAnalyticsTimelinePoint[] = [];
	const end = getUtcStartOfDay(now);

	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const date = addUtcDays(end, -offset);
		timeline.push({
			active: 0,
			cancelled: 0,
			date: formatUtcDateKey(date),
			expired: 0,
			failure: 0,
			success: 0,
			total: 0,
		});
	}

	return timeline;
}

export function formatUtcDateKey(date: Date | string): string {
	if (typeof date === "string") {
		if (UTC_DATE_KEY_PATTERN.test(date)) {
			return date;
		}

		const parsedDate = new Date(date);

		if (Number.isNaN(parsedDate.getTime())) {
			throw new Error("invalid_session_analytics_date");
		}

		return parsedDate.toISOString().slice(0, 10);
	}

	return date.toISOString().slice(0, 10);
}

export function getUtcStartOfDay(date: Date): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
}

export function addUtcDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setUTCDate(result.getUTCDate() + days);
	return result;
}

export function isTerminalSessionAnalyticsOutcome(
	outcome: SessionAnalyticsOutcome,
): outcome is TerminalSessionAnalyticsOutcome {
	return outcome !== "active";
}

export function shouldRunExpiredSessionNormalization(
	scheduledTime: Date | number,
): boolean {
	const date =
		scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime);

	return date.getUTCMinutes() % 5 === 0;
}
