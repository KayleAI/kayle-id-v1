import { OpenAPIHono } from "@hono/zod-openapi";
import {
	cancelOrgDeletion,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { orgDeletionErrorBody } from "../delete-errors";
import { cancelOrgDeletionRoute } from "./openapi";

const cancelDelete = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { userId?: string };
}>();

cancelDelete.openapi(cancelOrgDeletionRoute, async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	if (!userId) {
		return c.json(
			{
				data: null,
				error: {
					code: "UNAUTHORIZED" as const,
					message: "Sign in to cancel organization deletion.",
					hint: "Send a session cookie or use a session-authenticated client.",
					docs: "https://kayle.id/docs/api/errors#unauthorized",
				},
			},
			401,
		);
	}
	const { organizationId } = c.req.valid("json");

	try {
		await cancelOrgDeletion({ organizationId, actingUserId: userId });
		return c.json({ data: { ok: true as const }, error: null }, 200);
	} catch (error) {
		if (error instanceof OrgDeletionError) {
			const body = orgDeletionErrorBody(error);
			if (error.status === 403) {
				return c.json(body, 403);
			}
			if (error.status === 404) {
				return c.json(body, 404);
			}
			return c.json(body, 400);
		}
		logSafeError(log, {
			code: "org_deletion_cancel_failed",
			error,
			event: "organizations.deletion.cancel.failed",
			message: "Failed to cancel organization deletion.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to cancel organization deletion.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

export { cancelDelete };
