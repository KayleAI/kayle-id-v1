import { indexBy } from "@kayle-id/config/collections";
import {
	addUtcDays,
	createZeroFilledSessionAnalyticsTimeline,
	createZeroFilledSessionAnalyticsTrend,
	getUtcStartOfDay,
	SESSION_ANALYTICS_TREND_DAYS,
	type SessionAnalyticsOverview,
} from "@/v1/analytics/session-analytics";
import {
	applyTimelineCounts,
	buildCreatedCountByDate,
	buildSessionAnalyticsSummary,
	buildTerminalBase,
	buildTerminalCountByDate,
} from "./session-analytics-builders";
import { loadSessionAnalyticsRows } from "./session-analytics-query";

export async function getVerificationSessionAnalyticsOverview({
	now = new Date(),
	organizationId,
}: {
	now?: Date;
	organizationId: string;
}): Promise<SessionAnalyticsOverview> {
	const trend = createZeroFilledSessionAnalyticsTrend({
		days: SESSION_ANALYTICS_TREND_DAYS,
		now,
	});
	const timeline = createZeroFilledSessionAnalyticsTimeline({
		days: SESSION_ANALYTICS_TREND_DAYS,
		now,
	});
	const trendStart = addUtcDays(
		getUtcStartOfDay(now),
		-(SESSION_ANALYTICS_TREND_DAYS - 1),
	);
	const trendEndExclusive = addUtcDays(getUtcStartOfDay(now), 1);
	const trendByDate = indexBy(trend, "date");

	const rows = await loadSessionAnalyticsRows({
		now,
		organizationId,
		trendEndExclusive,
		trendStart,
	});
	const createdCountByDate = buildCreatedCountByDate(rows.createdDailyRows);
	const terminalBase = buildTerminalBase(rows.terminalBaseRows);
	const terminalCountByDate = buildTerminalCountByDate({
		rows: rows.trendRows,
		trendByDate,
	});
	const summary = buildSessionAnalyticsSummary({
		createdBaseCount: rows.createdBaseCount,
		createdCountByDate,
		terminalBase,
		terminalCountByDate,
	});
	applyTimelineCounts({
		createdCountByDate,
		terminalCountByDate,
		timeline,
	});

	return {
		summary,
		trend,
		timeline,
	};
}
