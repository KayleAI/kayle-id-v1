import { OpenAPIHono } from "@hono/zod-openapi";
import { findSoleOwnedOrganizations } from "@kayle-id/auth/owned-organizations";
import { logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { internalListOwnedOrganizations } from "./openapi";

const listOwnedOrganizations = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { userId: string };
}>();

listOwnedOrganizations.openapi(internalListOwnedOrganizations, async (c) => {
	const log = getRequestLogger(c);

	try {
		const organizations = await findSoleOwnedOrganizations(c.get("userId"));

		return c.json(
			{
				data: { organizations },
				error: null,
			},
			200,
		);
	} catch (error) {
		logSafeError(log, {
			code: "owned_organizations_list_failed",
			error,
			event: "account.owned_organizations.failed",
			message: "The sole-owned organizations could not be loaded.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to load owned organizations.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

export { listOwnedOrganizations };
