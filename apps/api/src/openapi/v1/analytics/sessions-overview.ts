import { createRoute, z } from "@hono/zod-openapi";
import { InternalServerErrorResponse } from "@/openapi/errors";
import { SessionAnalyticsOverview } from "@/openapi/models/analytics";

export const getSessionsOverview = createRoute({
	method: "get",
	path: "/sessions/overview",
	tags: ["Analytics"],
	summary: "Get organization session analytics overview",
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: SessionAnalyticsOverview,
						error: z.null(),
					}),
				},
			},
			description:
				"Successful operation. Returns overall session analytics summary, daily terminal outcomes grouped by session creation date for the last 14 days, and period-scoped cumulative timeline data for the same window.",
		},
		500: {
			content: {
				"application/json": {
					schema: InternalServerErrorResponse,
				},
			},
			description: "Internal server error.",
		},
	},
});
