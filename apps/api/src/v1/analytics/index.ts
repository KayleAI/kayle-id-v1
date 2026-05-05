import { OpenAPIHono } from "@hono/zod-openapi";
import { getSessionsOverview } from "@/openapi/v1/analytics/sessions-overview";
import { getVerificationSessionAnalyticsOverview } from "@/v1/sessions/repo/session-repo";

const analytics = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		organizationId: string;
	};
}>();

analytics.openapi(getSessionsOverview, async (c) => {
	const data = await getVerificationSessionAnalyticsOverview({
		organizationId: c.get("organizationId"),
	});

	return c.json(
		{
			data,
			error: null,
		},
		200,
	);
});

export default analytics;
