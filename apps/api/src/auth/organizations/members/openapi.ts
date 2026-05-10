import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";

const SuccessEnvelope = z.object({
	data: z.object({
		message: z.string(),
		status: z.literal("success"),
	}),
	error: z.null(),
});

export const suspendMemberRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "delete",
	path: "/members/{id}",
	tags: ["Organizations"],
	summary:
		"Suspend a member of the active organization. The membership row is preserved so audit-log entries can keep attributing past actions to the user; only an owner/admin can act, and the last active owner cannot be suspended.",
	request: {
		params: z.object({
			id: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: SuccessEnvelope } },
			description: "Member suspended.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller is not an admin or owner of this organization.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Member not found in this organization.",
		},
		409: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Cannot suspend the last active owner of the organization.",
		},
		410: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization is scheduled for deletion.",
		},
	},
});

export const leaveOrganizationRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/members/leave",
	tags: ["Organizations"],
	summary:
		"Leave the active organization. The caller's membership is suspended (not deleted) so audit attribution is preserved. The last active owner cannot leave.",
	responses: {
		200: {
			content: { "application/json": { schema: SuccessEnvelope } },
			description: "Caller's membership suspended.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller is not a member of this organization.",
		},
		409: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Cannot leave because the caller is the last active owner.",
		},
		410: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization is scheduled for deletion.",
		},
	},
});

export const reinstateMemberRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/members/{id}/reinstate",
	tags: ["Organizations"],
	summary:
		"Reinstate a previously-suspended member of the active organization. Only an owner/admin can act.",
	request: {
		params: z.object({
			id: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: SuccessEnvelope } },
			description: "Member reinstated.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller is not an admin or owner of this organization.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description:
				"Member not found, or member is not currently suspended in this organization.",
		},
		409: {
			content: { "application/json": { schema: ErrorResponse } },
			description:
				"Cannot reinstate: another active membership for this user already exists.",
		},
		410: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization is scheduled for deletion.",
		},
	},
});
