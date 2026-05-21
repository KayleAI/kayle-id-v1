import type { RouteHandler } from "@hono/zod-openapi";
import type { getSession } from "@/openapi/v1/sessions/get-by-id";
import { mapSessionRowToResponse } from "@/v1/sessions/mappers/session-response";
import { getVerificationSessionById } from "@/v1/sessions/repo/session-repo";
import type { SessionsAppEnv } from "@/v1/sessions/types";

export const getSessionHandler: RouteHandler<
	typeof getSession,
	SessionsAppEnv
> = async (c) => {
	const organizationId = c.get("organizationId");
	const params = c.req.valid("param");

	const row = await getVerificationSessionById({
		id: params.id,
		organizationId,
	});

	if (!row) {
		return c.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Session not found.",
					hint: "The session with the given ID was not found.",
					docs: "https://kayle.id/docs/api/sessions#get-by-id",
				},
			},
			404,
		);
	}

	const data = mapSessionRowToResponse({ row });

	return c.json(
		{
			data,
			error: null,
		},
		200,
	);
};
