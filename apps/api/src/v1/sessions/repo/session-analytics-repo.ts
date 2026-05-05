import { indexBy } from "@kayle-id/config/collections";
import { db } from "@kayle-id/database/drizzle";
import { sql } from "drizzle-orm";
import {
	addUtcDays,
	createEmptySessionAnalyticsSummary,
	createZeroFilledSessionAnalyticsTimeline,
	createZeroFilledSessionAnalyticsTrend,
	formatUtcDateKey,
	getUtcStartOfDay,
	isTerminalSessionAnalyticsOutcome,
	SESSION_ANALYTICS_TREND_DAYS,
	type SessionAnalyticsOutcome,
	type SessionAnalyticsOverview,
	type SessionAnalyticsSummary,
} from "@/v1/analytics/session-analytics";

type SessionAnalyticsSummaryRow = {
	count: number;
	outcome: SessionAnalyticsOutcome;
};

type SessionAnalyticsTrendRow = {
	count: number;
	dateKey: Date | string;
	outcome: SessionAnalyticsOutcome;
};

type SessionAnalyticsCreatedRow = {
	count: number;
	dateKey: Date | string;
};

type SessionAnalyticsCountRow = {
	count: number;
};

type SessionAnalyticsTerminalCounts = Omit<
	SessionAnalyticsSummary,
	"active" | "total"
>;

function createSessionAnalyticsCte({
	now,
	organizationId,
}: {
	now: Date;
	organizationId: string;
}) {
	return sql`
    with attempt_rollup as (
      select
        verification_session_id,
        bool_or(status = 'succeeded') as has_succeeded
      from verification_attempts
      group by verification_session_id
    ),
    session_outcomes as (
      select
        case
          when verification_sessions.status = 'cancelled' then 'cancelled'
          when verification_sessions.status = 'expired'
            or (
              verification_sessions.status in ('created', 'in_progress')
              and verification_sessions.expires_at <= ${now}
            )
            then 'expired'
          when coalesce(attempt_rollup.has_succeeded, false) then 'success'
          when verification_sessions.status = 'completed' then 'failure'
          else 'active'
        end as outcome,
        verification_sessions.created_at as created_at,
        case
          when verification_sessions.status = 'cancelled'
            then verification_sessions.completed_at
          when verification_sessions.status = 'expired'
            then coalesce(
              verification_sessions.completed_at,
              verification_sessions.expires_at
            )
          when verification_sessions.status in ('created', 'in_progress')
            and verification_sessions.expires_at <= ${now}
            then verification_sessions.expires_at
          else verification_sessions.completed_at
        end as outcome_at
      from verification_sessions
      left join attempt_rollup
        on attempt_rollup.verification_session_id = verification_sessions.id
      where verification_sessions.organization_id = ${organizationId}
    )
  `;
}

function createEmptyTerminalCounts(): SessionAnalyticsTerminalCounts {
	return {
		cancelled: 0,
		expired: 0,
		failure: 0,
		success: 0,
	};
}

function buildCreatedCountByDate(
	rows: SessionAnalyticsCreatedRow[],
): Map<string, number> {
	const createdCountByDate = new Map<string, number>();

	for (const row of rows) {
		createdCountByDate.set(formatUtcDateKey(row.dateKey), row.count);
	}

	return createdCountByDate;
}

function buildTerminalBase(
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

function buildTerminalCountByDate({
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

function buildSessionAnalyticsSummary({
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

function applyTimelineCounts({
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
	const analyticsCte = createSessionAnalyticsCte({
		now,
		organizationId,
	});

	const createdBaseResult = await db.execute<SessionAnalyticsCountRow>(sql`
    ${analyticsCte}
    select
      count(*)::int as count
    from session_outcomes
    where created_at < ${trendStart}
  `);

	const createdDailyResult = await db.execute<SessionAnalyticsCreatedRow>(sql`
    ${analyticsCte}
    select
      created_at::date as "dateKey",
      count(*)::int as count
    from session_outcomes
    where created_at >= ${trendStart}
      and created_at < ${trendEndExclusive}
    group by created_at::date
  `);

	const terminalBaseResult = await db.execute<SessionAnalyticsSummaryRow>(sql`
    ${analyticsCte}
    select
      outcome,
      count(*)::int as count
    from session_outcomes
    where outcome in ('success', 'failure', 'expired', 'cancelled')
      and outcome_at is not null
      and created_at < ${trendStart}
    group by outcome
  `);

	const trendResult = await db.execute<SessionAnalyticsTrendRow>(sql`
    ${analyticsCte}
    select
      outcome,
      created_at::date as "dateKey",
      count(*)::int as count
    from session_outcomes
    where outcome in ('success', 'failure', 'expired', 'cancelled')
      and outcome_at is not null
      and created_at >= ${trendStart}
      and created_at < ${trendEndExclusive}
    group by outcome, created_at::date
  `);

	const createdCountByDate = buildCreatedCountByDate(createdDailyResult.rows);
	const terminalBase = buildTerminalBase(terminalBaseResult.rows);
	const terminalCountByDate = buildTerminalCountByDate({
		rows: trendResult.rows,
		trendByDate,
	});
	const summary = buildSessionAnalyticsSummary({
		createdBaseCount: createdBaseResult.rows[0]?.count ?? 0,
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
