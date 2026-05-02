import { OpenAPIHono } from "@hono/zod-openapi";
import { auth } from "@kayle-id/auth/server";
import { env } from "@kayle-id/config/env";
import { logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { LogoValidationError, uploadOrganizationLogo } from "./logo";
import { internalCreateOrganization } from "./openapi";

const createOrganizationRoute = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { userId: string };
}>();

createOrganizationRoute.openapi(internalCreateOrganization, async (c) => {
	const { name, slug, logo } = c.req.valid("json");
	const log = getRequestLogger(c);

	try {
		const logoUrl = logo
			? await uploadOrganizationLogo({
					logo,
					storage: env.STORAGE,
				})
			: null;
		const state = await auth.api.createOrganization({
			body: {
				name,
				slug,
				...(logoUrl ? { logo: logoUrl } : {}),
				userId: c.get("userId"),
			},
		});

		if (!state?.id) {
			throw new Error("Failed to create organization — No ID returned");
		}

		return c.json(
			{
				data: { id: state.id },
				error: null,
			},
			200,
		);
	} catch (error) {
		if (error instanceof LogoValidationError) {
			return c.json(
				{
					data: null,
					error: {
						code: "INVALID_LOGO",
						message: error.message,
						hint: "Provide a PNG, JPEG, GIF, or WebP image under 1 MiB whose content type matches its bytes.",
						docs: "https://kayle.id/docs/api/errors#invalid_logo",
					} as const,
				},
				400,
			);
		}

		logSafeError(log, {
			code: "organization_create_failed",
			error,
			event: "organizations.create.failed",
			message: "The organization could not be created.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create organization.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				} as const,
			},
			500,
		);
	}
});

export default createOrganizationRoute;
