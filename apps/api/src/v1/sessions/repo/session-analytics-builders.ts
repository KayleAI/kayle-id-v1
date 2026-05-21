import {
	createEmptySessionAnalyticsSummary,
	formatUtcDateKey,
	isTerminalSessionAnalyticsOutcome,
	type SessionAnalyticsOverview,
	type SessionAnalyticsSummary,
} from "@/v1/analytics/session-analytics";
import type {
	SessionAnalyticsCreatedRow,
	SessionAnalyticsSummaryRow,
	SessionAnalyticsTerminalCounts,
	SessionAnalyticsTrendRow,
} from "./session-analytics-types";

function createEmptyTerminalCounts(): SessionAnalyticsTerminalCounts {
	return {
		cancelled: 0,
		expired: 0,
		failure: 0,
		success: 0,
	};
}

export function buildCreatedCountByDate(
	rows: SessionAnalyticsCreatedRow[],
): Map<string, number> {
	const createdCountByDate = new Map<string, number>();

	for (const row of rows) {
		createdCountByDate.set(formatUtcDateKey(row.dateKey), row.count);
	}

	return createdCountByDate;
}

export function buildTerminalBase(
	rows: SessionAnalyticsSummaryRow[],
): SessionAnalyticsTerminalCounts {
	const terminalBase = createEmptyTerminalCounts();

	for (const row of rows) {
		if (isTerminalSessionAnalyticsOutcome(row.outcome)) {
			terminalBase[row.outcome] = row.count;
		}
	}

	return terminalBase;
}

export function buildTerminalCountByDate({
	rows,
	trendByDate,
}: {
	rows: SessionAnalyticsTrendRow[];
	trendByDate: Map<string, SessionAnalyticsOverview["trend"][number]>;
}): Map<string, SessionAnalyticsTerminalCounts> {
	const terminalCountByDate = new Map<string, SessionAnalyticsTerminalCounts>();

	for (const row of rows) {
		if (!isTerminalSessionAnalyticsOutcome(row.outcome)) {
			continue;
		}

		const dateKey = formatUtcDateKey(row.dateKey);
		const trendPoint = trendByDate.get(dateKey);
		const currentCounts =
			terminalCountByDate.get(dateKey) ?? createEmptyTerminalCounts();

		currentCounts[row.outcome] += row.count;
		terminalCountByDate.set(dateKey, currentCounts);

		if (trendPoint) {
			trendPoint[row.outcome] += row.count;
		}
	}

	return terminalCountByDate;
}

export function buildSessionAnalyticsSummary({
	createdBaseCount,
	createdCountByDate,
	terminalBase,
	terminalCountByDate,
}: {
	createdBaseCount: number;
	createdCountByDate: Map<string, number>;
	terminalBase: SessionAnalyticsTerminalCounts;
	terminalCountByDate: Map<string, SessionAnalyticsTerminalCounts>;
}): SessionAnalyticsSummary {
	const summary = createEmptySessionAnalyticsSummary();

	summary.total = createdBaseCount;
	summary.success = terminalBase.success;
	summary.failure = terminalBase.failure;
	summary.expired = terminalBase.expired;
	summary.cancelled = terminalBase.cancelled;

	for (const count of createdCountByDate.values()) {
		summary.total += count;
	}

	for (const terminalCounts of terminalCountByDate.values()) {
		summary.success += terminalCounts.success;
		summary.failure += terminalCounts.failure;
		summary.expired += terminalCounts.expired;
		summary.cancelled += terminalCounts.cancelled;
	}

	summary.active =
		summary.total -
		summary.success -
		summary.failure -
		summary.expired -
		summary.cancelled;

	return summary;
}

export function applyTimelineCounts({
	createdCountByDate,
	terminalCountByDate,
	timeline,
}: {
	createdCountByDate: Map<string, number>;
	terminalCountByDate: Map<string, SessionAnalyticsTerminalCounts>;
	timeline: SessionAnalyticsOverview["timeline"];
}): void {
	let runningTotal = 0;
	let runningSuccess = 0;
	let runningFailure = 0;
	let runningExpired = 0;
	let runningCancelled = 0;

	for (const point of timeline) {
		runningTotal += createdCountByDate.get(point.date) ?? 0;

		const terminalCounts = terminalCountByDate.get(point.date);
		runningSuccess += terminalCounts?.success ?? 0;
		runningFailure += terminalCounts?.failure ?? 0;
		runningExpired += terminalCounts?.expired ?? 0;
		runningCancelled += terminalCounts?.cancelled ?? 0;

		point.total = runningTotal;
		point.success = runningSuccess;
		point.failure = runningFailure;
		point.expired = runningExpired;
		point.cancelled = runningCancelled;
		point.active =
			runningTotal -
			runningSuccess -
			runningFailure -
			runningExpired -
			runningCancelled;
	}
}
