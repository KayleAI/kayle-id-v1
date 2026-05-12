import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";

const apexSchema = z.string().trim().min(3).max(253);
const challengeIdSchema = z.string().uuid();
const domainIdSchema = z.string().uuid();

const verifiedDomainShape = z.object({
	id: z.string().uuid(),
	apexDomain: z.string(),
	verifiedAt: z.string(),
	verifiedVia: z.enum(["dns_txt"]),
	lastCheckedAt: z.string().nullable(),
	downgradedAt: z.string().nullable(),
});

const activeChallengeShape = z.object({
	id: z.string().uuid(),
	apexDomain: z.string(),
	method: z.enum(["dns_txt"]),
	expiresAt: z.string(),
	createdAt: z.string(),
});

const standardErrors = {
	400: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Bad request.",
	},
	401: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Unauthorized.",
	},
	403: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Caller is not an owner of this organization.",
	},
	404: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Not found.",
	},
	409: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Conflict.",
	},
	410: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Organization is scheduled for deletion.",
	},
	422: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Validation error.",
	},
	429: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Too many requests.",
	},
	500: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Internal server error.",
	},
	502: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Upstream error.",
	},
	503: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Upstream temporarily unavailable.",
	},
};

export const startDnsChallengeRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/domains/challenges/dns",
	tags: ["Organizations"],
	summary: "Start a DNS-based domain verification challenge.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ apex_domain: apexSchema }),
				},
			},
			required: true,
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							challenge_id: z.string().uuid(),
							record_name: z.string(),
							record_value: z.string(),
							expires_at: z.string(),
							conflict: z.object({ organization_name: z.string() }).nullable(),
						}),
						error: z.null(),
					}),
				},
			},
			description: "DNS challenge issued.",
		},
		...standardErrors,
	},
});

export const verifyDnsChallengeRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/domains/challenges/dns/verify",
	tags: ["Organizations"],
	summary: "Poll a DNS challenge — verifies the TXT record is in place.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						challenge_id: challengeIdSchema,
						acknowledge_takeover: z.boolean().optional(),
					}),
				},
			},
			required: true,
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							domain_id: z.string().uuid(),
							apex_domain: z.string(),
							takeover_from: z
								.object({
									organization_id: z.string().uuid(),
									organization_name: z.string(),
								})
								.nullable(),
						}),
						error: z.null(),
					}),
				},
			},
			description: "Domain verified.",
		},
		...standardErrors,
	},
});

export const listDomainsRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "get",
	path: "/domains",
	tags: ["Organizations"],
	summary: "List verified domains and active challenges for the active org.",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							domains: z.array(verifiedDomainShape),
							challenges: z.array(activeChallengeShape),
						}),
						error: z.null(),
					}),
				},
			},
			description: "List returned.",
		},
		...standardErrors,
	},
});

export const removeDomainRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "delete",
	path: "/domains/{id}",
	tags: ["Organizations"],
	summary: "Revoke a verified domain.",
	request: {
		params: z.object({ id: domainIdSchema }),
	},
	responses: {
		204: { description: "Removed." },
		...standardErrors,
	},
});
