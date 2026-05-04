import { OpenAPIHono } from "@hono/zod-openapi";
import { auth } from "@kayle-id/auth/server";
import { createMiddleware } from "hono/factory";
import { unauthorized } from "@/v1/auth";
import { listOwnedOrganizations } from "./list-owned-organizations";

const account = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

const accountMiddleware = createMiddleware<{
	Bindings: CloudflareBindings;
	Variables: {
		type: "session";
		userId: string;
	};
}>(async (c, next) => {
	const response = await auth.api.getSession(c.req.raw);

	if (!response?.session) {
		return unauthorized(c);
	}

	c.set("type", "session");
	c.set("userId", response.session.userId);
	await next();
});

account.use(accountMiddleware);

account.route("/", listOwnedOrganizations);

export default account;
