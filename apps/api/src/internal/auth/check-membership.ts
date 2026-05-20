import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { auth } from "@kayle-id/auth/server";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq, isNull } from "drizzle-orm";
import { hasOrgRole } from "@/auth/permissions";
import { ErrorResponse } from "@/openapi/base";

const ROLES = ["owner", "admin", "member"] as const;

/**
 * Resolve membership for the user identified by the request's session cookie.
 * Used by the platform server when it needs to act on behalf of a logged-in
 * user (e.g. starting an org-verification flow). Trust-token gated so only the
 * platform can call it.
 */
const checkSessionMembershipRoute = createRoute({
	hide: true,
	method: "post",
	path: "/check-session-membership",
	tags: ["Internal"],
	summary:
		"Resolve the calling session's user, then return their membership/role for the supplied organization.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organization_id: z.string().uuid(),
					}),
				},
			},
			required: true,
		},
	},
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							user_id: z.string(),
							role: z.enum(ROLES).nullable(),
							is_owner: z.boolean(),
							is_admin_or_owner: z.boolean(),
							organization: z
								.object({
									id: z.string(),
									verified_at: z.string().nullable(),
									pending_deletion_at: z.string().nullable(),
									verification_terms_accepted_at: z.string().nullable(),
								})
								.nullable(),
						}),
						error: z.null(),
					}),
				},
			},
			description:
				"Membership lookup result. `role` is null when the user is not a member of the org. `organization` is null when the org doesn't exist.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description:
				"Trust token missing/invalid, or no signed-in session was found.",
		},
	},
});

const checkMembership = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

checkMembership.openapi(checkSessionMembershipRoute, async (c) => {
	const sessionResponse = await auth.api.getSession(c.req.raw);
	const userId = sessionResponse?.session?.userId ?? null;
	if (!userId) {
		return c.json(
			{
				data: null,
				error: {
					code: "UNAUTHORIZED",
					message: "No signed-in session found.",
					hint: "Forward the calling user's session cookie when invoking this endpoint.",
					docs: "https://kayle.id/docs/api/errors#unauthorized",
				},
			},
			401,
		);
	}

	const body = c.req.valid("json");

	const [org] = await db
		.select({
			id: auth_organizations.id,
			verifiedAt: auth_organizations.owner_id_checked_at,
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			verificationTermsAcceptedAt:
				auth_organizations.verification_terms_accepted_at,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, body.organization_id))
		.limit(1);

	const orgPayload = org
		? {
				id: org.id,
				verified_at: org.verifiedAt ? org.verifiedAt.toISOString() : null,
				pending_deletion_at: org.pendingDeletionAt
					? org.pendingDeletionAt.toISOString()
					: null,
				verification_terms_accepted_at: org.verificationTermsAcceptedAt
					? org.verificationTermsAcceptedAt.toISOString()
					: null,
			}
		: null;

	const [member] = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, body.organization_id),
				eq(auth_organization_members.userId, userId),
				// Treat suspended memberships as non-members for permission purposes.
				isNull(auth_organization_members.suspendedAt),
			),
		)
		.limit(1);

	if (!member) {
		return c.json(
			{
				data: {
					user_id: userId,
					role: null,
					is_owner: false,
					is_admin_or_owner: false,
					organization: orgPayload,
				},
				error: null,
			},
			200,
		);
	}

	const isOwner = hasOrgRole(member.role, "owner");
	const isAdminOrOwner = hasOrgRole(member.role, "admin");

	const primary: "owner" | "admin" | "member" | null = isOwner
		? "owner"
		: isAdminOrOwner
			? "admin"
			: hasOrgRole(member.role, "member")
				? "member"
				: null;

	return c.json(
		{
			data: {
				user_id: userId,
				role: primary,
				is_owner: isOwner,
				is_admin_or_owner: isAdminOrOwner,
				organization: orgPayload,
			},
			error: null,
		},
		200,
	);
});

export default checkMembership;
