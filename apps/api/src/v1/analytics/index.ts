import { OpenAPIHono } from "@hono/zod-openapi";
import { getSessionsOverview } from "@/openapi/v1/analytics/sessions-overview";
import { getVerificationSessionAnalyticsOverview } from "@/v1/sessions/repo/session-repo";

const analytics = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		environment: "live" | "test" | "either";
		organizationId: string;
	};
}>();

analytics.openapi(getSessionsOverview, async (c) => {
	const baseEnvironment = c.get("environment");
	const environment = baseEnvironment === "either" ? "live" : baseEnvironment;
	const data = await getVerificationSessionAnalyticsOverview({
		environment,
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
