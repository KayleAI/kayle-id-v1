import { OpenAPIHono } from "@hono/zod-openapi";
import {
	auth,
	getActiveOrganizationId,
	isPlatformAdminOrganization,
} from "@kayle-id/auth/server";
import { createMiddleware } from "hono/factory";
import { forbidden, unauthorized } from "@/v1/auth";
import costAnalytics from "./cost-analytics";
import organizationReports from "./organization-reports";

const admin = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

// Session-only — no API-key access. Caller must be authenticated AND their
// active org must match the platform-admin org configured by the
// KAYLE_ORGANIZATION_ID env secret. Switching orgs in the platform UI is
// what enters/exits admin mode; membership alone is not enough.
const requirePlatformAdmin = createMiddleware<{
	Bindings: CloudflareBindings;
	Variables: {
		userId: string;
		organizationId: string;
	};
}>(async (c, next) => {
	const response = await auth.api.getSession(c.req.raw);

	if (!response?.session) {
		return unauthorized(c);
	}

	const activeOrganizationId = getActiveOrganizationId(response.session);

	if (!isPlatformAdminOrganization(activeOrganizationId)) {
		return forbidden(c);
	}

	c.set("userId", response.session.userId);
	c.set("organizationId", activeOrganizationId as string);
	await next();
});

admin.use(requirePlatformAdmin);

// First sub-route: a no-op probe so the platform UI can confirm gate
// behaviour end-to-end without depending on a real admin feature.
admin.get("/access", (c) =>
	c.json({
		data: { permitted: true },
		error: null,
	}),
);

admin.route("/", costAnalytics);
admin.route("/", organizationReports);

export default admin;
