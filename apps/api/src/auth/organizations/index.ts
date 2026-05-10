import { OpenAPIHono } from "@hono/zod-openapi";
import { auth, getActiveOrganizationId } from "@kayle-id/auth/server";
import { createMiddleware } from "hono/factory";
import { unauthorized } from "@/v1/auth";
import { acceptVerificationTerms } from "./accept-verification-terms";
import { auditLogs } from "./audit-logs";
import { businessDetails } from "./business-details";
import { cancelDelete } from "./cancel-delete";
import { confirmDelete } from "./confirm-delete";
import createOrganizationRoute from "./create";
import { domains } from "./domains";
import uploadLogoRoute from "./logo";
import { redirectUris } from "./redirect-uris";
import { requestDelete } from "./request-delete";

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
organizations.route("/", requestDelete);
organizations.route("/", confirmDelete);
organizations.route("/", cancelDelete);
organizations.route("/", acceptVerificationTerms);
organizations.route("/", businessDetails);
organizations.route("/", domains);
organizations.route("/", redirectUris);
organizations.route("/", auditLogs);

export default organizations;
