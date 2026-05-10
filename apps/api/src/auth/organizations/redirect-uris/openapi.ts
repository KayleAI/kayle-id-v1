import { createRoute, z } from "@hono/zod-openapi";
import { safeRedirectUrl } from "@kayle-id/config/safe-url";
import { ErrorResponse } from "@/openapi/base";

const ALLOW_LOOPBACK_URLS = process.env.NODE_ENV !== "production";

const redirectUriShape = z.object({
	id: z.string().uuid(),
	verifiedDomainId: z.string().uuid(),
	apexDomain: z.string(),
	pattern: z.string(),
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
	410: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Organization frozen.",
	},
	422: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Pattern host does not match a verified domain.",
	},
	500: {
		content: { "application/json": { schema: ErrorResponse } },
		description: "Internal server error.",
	},
} as const;

export const listRedirectUrisRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "get",
	path: "/redirect-uris",
	tags: ["Organizations"],
	summary: "List the redirect URI allowlist for the active organization.",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.array(redirectUriShape),
						error: z.null(),
					}),
				},
			},
			description: "List returned.",
		},
		...standardErrors,
	},
});

export const addRedirectUriRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/redirect-uris",
	tags: ["Organizations"],
	summary: "Register a redirect URI on a verified domain.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// Patterns are matched as strict path-prefixes against incoming
						// `redirect_url` values. Allowing query strings or fragments would
						// either over-match (anyone passing the same path with extra
						// params would match) or under-match (only that exact query would
						// match) — neither is useful, so we reject both up front. The UI
						// composes patterns from a domain dropdown + path field that
						// can't produce these characters.
						pattern: safeRedirectUrl({
							allowLoopback: ALLOW_LOOPBACK_URLS,
						}).refine(
							(value) => !(value.includes("?") || value.includes("#")),
							{
								message:
									"Redirect URI pattern must not contain query strings or fragments.",
							},
						),
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
						data: redirectUriShape,
						error: z.null(),
					}),
				},
			},
			description: "Registered.",
		},
		...standardErrors,
	},
});

export const removeRedirectUriRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "delete",
	path: "/redirect-uris/{id}",
	tags: ["Organizations"],
	summary: "Remove a redirect URI from the allowlist.",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		204: { description: "Removed." },
		...standardErrors,
	},
});
