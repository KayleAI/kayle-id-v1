import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { env } from "@kayle-id/config/env";
import { logSafeError } from "@kayle-id/config/logging";
import {
	LogoValidationError,
	uploadOrganizationLogo,
} from "@/auth/organizations/create/logo";
import { checkPermission } from "@/functions/auth/check-permission";
import { getRequestLogger } from "@/logging";
import { denyIfOrgFrozen } from "@/v1/auth";
import { internalUploadOrganizationLogo } from "./openapi";

const uploadLogoRoute = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: null | string; userId?: string };
}>();

uploadLogoRoute.openapi(internalUploadOrganizationLogo, async (c) => {
	const { logo } = c.req.valid("json");
	const log = getRequestLogger(c);
	const organizationId = c.get("organizationId");
	const userId = c.get("userId");

	if (
		!(organizationId && userId) ||
		!(await checkPermission(userId, organizationId, "admin"))
	) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN",
					message: "Only an owner or admin can upload an organization logo.",
					hint: "Sign in as an organization owner or admin.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				} as const,
			},
			403,
		);
	}

	const frozenResponse = await denyIfOrgFrozen(c);
	if (frozenResponse) {
		return frozenResponse;
	}

	try {
		const logoUrl = await uploadOrganizationLogo({
			logo,
			storage: env.STORAGE,
		});

		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: userId,
			organizationId,
			event: "organization.logo.updated",
			targetId: organizationId,
			targetType: "organization",
		});

		return c.json(
			{
				data: { logo: logoUrl },
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
			code: "organization_logo_upload_failed",
			error,
			event: "organizations.logo.upload.failed",
			message: "The organization logo could not be uploaded.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to upload organization logo.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				} as const,
			},
			500,
		);
	}
});

export default uploadLogoRoute;
