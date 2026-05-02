import { z } from "@hono/zod-openapi";

export const SessionAnalyticsSummary = z
	.object({
		total: z.number().int().nonnegative(),
		active: z.number().int().nonnegative(),
		success: z.number().int().nonnegative(),
		failure: z.number().int().nonnegative(),
		expired: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
	})
	.openapi("SessionAnalyticsSummary");

export const SessionAnalyticsTrendPoint = z
	.object({
		date: z
			.string()
			.describe("UTC date bucket in YYYY-MM-DD format.")
			.openapi({ example: "2026-03-21" }),
		success: z.number().int().nonnegative(),
		failure: z.number().int().nonnegative(),
		expired: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
	})
	.openapi("SessionAnalyticsTrendPoint");

export const SessionAnalyticsTimelinePoint = z
	.object({
		date: z
			.string()
			.describe("UTC date bucket in YYYY-MM-DD format.")
			.openapi({ example: "2026-03-21" }),
		total: z.number().int().nonnegative(),
		active: z.number().int().nonnegative(),
		success: z.number().int().nonnegative(),
		failure: z.number().int().nonnegative(),
		expired: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
	})
	.openapi("SessionAnalyticsTimelinePoint");

export const SessionAnalyticsOverview = z
	.object({
		summary: SessionAnalyticsSummary.describe(
			"Overall session counts for the organization in the selected environment.",
		),
		trend: z
			.array(SessionAnalyticsTrendPoint)
			.describe(
				"Daily terminal session outcomes grouped by session creation date for the last 14 days.",
			),
		timeline: z
			.array(SessionAnalyticsTimelinePoint)
			.describe(
				"Last 14 days of daily cumulative counts grouped by session creation date within the current analytics window.",
			),
	})
	.openapi({
		examples: [
			{
				summary: {
					total: 142,
					active: 9,
					success: 103,
					failure: 18,
					expired: 8,
					cancelled: 4,
				},
				trend: [
					{
						date: "2026-03-08",
						success: 2,
						failure: 1,
						expired: 0,
						cancelled: 0,
					},
					{
						date: "2026-03-09",
						success: 1,
						failure: 0,
						expired: 1,
						cancelled: 1,
					},
				],
				timeline: [
					{
						date: "2026-03-08",
						total: 5,
						active: 2,
						success: 2,
						failure: 1,
						expired: 0,
						cancelled: 0,
					},
					{
						date: "2026-03-09",
						total: 9,
						active: 3,
						success: 3,
						failure: 1,
						expired: 1,
						cancelled: 1,
					},
				],
			},
		],
	});
