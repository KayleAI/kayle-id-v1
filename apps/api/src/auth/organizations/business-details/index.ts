import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	normalizeOrganizationBusinessJurisdiction,
	normalizeOrganizationBusinessName,
	normalizeOrganizationBusinessRegistrationNumber,
	normalizeOrganizationBusinessType,
	OrganizationBusinessDetailsError,
	type OrganizationBusinessType,
} from "@kayle-id/auth/organization-business-details";
import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { hasOrgRole } from "@kayle-id/auth/permissions";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq, isNull } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import { updateOrganizationBusinessDetailsRoute } from "./openapi";

const businessDetails = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>();

businessDetails.openapi(updateOrganizationBusinessDetailsRoute, async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");

	if (!userId) {
		return c.json(
			{
				data: null,
				error: {
					code: "UNAUTHORIZED" as const,
					message: "Sign in to update business details.",
					hint: "Send a session cookie or use a session-authenticated client.",
					docs: "https://kayle.id/docs/api/errors#unauthorized",
				},
			},
			401,
		);
	}
	if (!organizationId) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Select an organization to update business details.",
					hint: "The active session must have an organization selected.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	try {
		await assertOrgNotFrozen(organizationId);
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_FROZEN" as const,
						message: error.message,
						hint: "Cancel the pending deletion before updating business details.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}

	const [membership] = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
				isNull(auth_organization_members.suspendedAt),
			),
		)
		.limit(1);

	if (!membership || !hasOrgRole(membership.role, "owner")) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Only an owner can update business details.",
					hint: "Ask an owner of this organization to update them.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	const body = c.req.valid("json");

	let normalized: {
		businessType?: OrganizationBusinessType | null;
		businessName?: string | null;
		businessJurisdiction?: string | null;
		businessRegistrationNumber?: string | null;
	};
	try {
		normalized = {
			businessType: normalizeOrganizationBusinessType(body.business_type),
			businessName: normalizeOrganizationBusinessName(body.business_name),
			businessJurisdiction: normalizeOrganizationBusinessJurisdiction(
				body.business_jurisdiction,
			),
			businessRegistrationNumber:
				normalizeOrganizationBusinessRegistrationNumber(
					body.business_registration_number,
				),
		};
	} catch (error) {
		if (error instanceof OrganizationBusinessDetailsError) {
			return c.json(
				{
					data: null,
					error: {
						code: "INVALID_BUSINESS_DETAILS" as const,
						message: error.message,
						hint: `Check the ${error.field} value and resubmit.`,
						docs: "https://kayle.id/docs/api/errors#bad_request",
					},
				},
				400,
			);
		}
		throw error;
	}

	// Build the SET clause from only the fields the caller actually included.
	// `undefined` is "leave the column alone"; `null` is "clear it"; a string
	// is "set this trimmed value". This way the same endpoint supports patch-
	// style partial updates without forcing the UI to round-trip every field.
	const updates: Partial<{
		business_type: OrganizationBusinessType | null;
		business_name: string | null;
		business_jurisdiction: string | null;
		business_registration_number: string | null;
	}> = {};
	if (normalized.businessType !== undefined) {
		updates.business_type = normalized.businessType;
	}
	if (normalized.businessName !== undefined) {
		updates.business_name = normalized.businessName;
	}
	if (normalized.businessJurisdiction !== undefined) {
		updates.business_jurisdiction = normalized.businessJurisdiction;
	}
	if (normalized.businessRegistrationNumber !== undefined) {
		updates.business_registration_number =
			normalized.businessRegistrationNumber;
	}

	try {
		const [updated] = await db
			.update(auth_organizations)
			.set(
				Object.keys(updates).length > 0
					? updates
					: // No-op update — fall through to a SELECT by way of returning
						// the current row so the response shape stays consistent.
						{},
			)
			.where(eq(auth_organizations.id, organizationId))
			.returning({
				businessType: auth_organizations.business_type,
				businessName: auth_organizations.business_name,
				businessJurisdiction: auth_organizations.business_jurisdiction,
				businessRegistrationNumber:
					auth_organizations.business_registration_number,
			});

		if (!updated) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_NOT_FOUND" as const,
						message: "Organization not found.",
						hint: "Provide an existing organization ID.",
						docs: "https://kayle.id/docs/api/errors#not_found",
					},
				},
				404,
			);
		}

		logEvent(log, {
			details: {
				organization_id: organizationId,
				updated_fields: Object.keys(updates),
			},
			event: "organizations.business_details.updated",
		});

		if (Object.keys(updates).length > 0) {
			await recordAuditLogSafe({
				actorType: "user",
				actorUserId: userId,
				organizationId,
				event: "organization.business_details.updated",
				targetId: organizationId,
				targetType: "organization",
				metadata: { updated_fields: Object.keys(updates) },
			});
		}

		return c.json(
			{
				data: {
					businessType: updated.businessType,
					businessName: updated.businessName,
					businessJurisdiction: updated.businessJurisdiction,
					businessRegistrationNumber: updated.businessRegistrationNumber,
				},
				error: null,
			},
			200,
		);
	} catch (error) {
		logSafeError(log, {
			code: "business_details_update_failed",
			error,
			event: "organizations.business_details.update.failed",
			message: "Failed to update business details.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to update business details.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

export { businessDetails };
