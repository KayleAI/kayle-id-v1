import { OpenAPIHono } from "@hono/zod-openapi";
import { auth, getActiveOrganizationId } from "@kayle-id/auth/server";
import { createMiddleware } from "hono/factory";
import { unauthorized } from "@/v1/auth";
import createOrganizationRoute from "./create";
import uploadLogoRoute from "./logo";

const organizations = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

const organizationMiddleware = createMiddleware<{
	Bindings: CloudflareBindings;
	Variables: {
		type: "api" | "session";
		organizationId?: string | null;
		userId?: string;
	};
}>(async (c, next) => {
	const response = await auth.api.getSession(c.req.raw);

	if (!response?.session) {
		return unauthorized(c);
	}

	const activeOrganizationId = getActiveOrganizationId(response.session);

	c.set("type", "session");
	c.set("organizationId", activeOrganizationId);
	c.set("userId", response.session?.userId);
	await next();
});

organizations.use(organizationMiddleware);

organizations.route("/", createOrganizationRoute);
organizations.route("/", uploadLogoRoute);

export default organizations;
