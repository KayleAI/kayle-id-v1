import { db } from "@kayle-id/database/drizzle";
import { sql } from "drizzle-orm";
import type {
	SessionAnalyticsCreatedRow,
	SessionAnalyticsSummaryRow,
	SessionAnalyticsTrendRow,
} from "./session-analytics-types";

type SessionAnalyticsCountRow = {
	count: number;
};

function createSessionAnalyticsCte({
	now,
	organizationId,
}: {
	now: Date;
	organizationId: string;
}) {
	return sql`
    with session_outcomes as (
      select
        case
          when verification_sessions.status = 'cancelled' then 'cancelled'
          when verification_sessions.status = 'expired'
            or (
              verification_sessions.status in ('created', 'in_progress')
              and verification_sessions.expires_at <= ${now}
            )
            then 'expired'
          when verification_sessions.status = 'succeeded' then 'success'
          when verification_sessions.status = 'failed' then 'failure'
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
      where verification_sessions.organization_id = ${organizationId}
    )
  `;
}

export async function loadSessionAnalyticsRows({
	now,
	organizationId,
	trendEndExclusive,
	trendStart,
}: {
	now: Date;
	organizationId: string;
	trendEndExclusive: Date;
	trendStart: Date;
}): Promise<{
	createdBaseCount: number;
	createdDailyRows: SessionAnalyticsCreatedRow[];
	terminalBaseRows: SessionAnalyticsSummaryRow[];
	trendRows: SessionAnalyticsTrendRow[];
}> {
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

	return {
		createdBaseCount: createdBaseResult.rows[0]?.count ?? 0,
		createdDailyRows: createdDailyResult.rows,
		terminalBaseRows: terminalBaseResult.rows,
		trendRows: trendResult.rows,
	};
}
