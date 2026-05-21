import { isOrganizationSlug } from "@kayle-id/auth/organization-slug";
import type { Context, Hono } from "hono";
import {
	PUBLIC_ORGANIZATION_MAX_PAGE,
	PUBLIC_ORGANIZATION_SEARCH_MAX_LENGTH,
	UUID_PATTERN,
} from "./public-organizations-config";
import {
	getPublicOrganizationByIdentifier,
	searchPublicOrganizations,
} from "./public-organizations-repository";

type PublicOrganizationsApp = Hono<{ Bindings: CloudflareBindings }>;

function jsonError(
	c: Context,
	{
		code,
		message,
		status,
	}: {
		code: string;
		message: string;
		status: 400 | 404;
	},
) {
	return c.json(
		{
			data: null,
			error: { code, message },
		},
		status,
	);
}

function parsePublicOrganizationsPage(rawPage: null | string): number | null {
	if (!rawPage?.trim()) {
		return 1;
	}

	if (!/^\d+$/.test(rawPage)) {
		return null;
	}

	const page = Number.parseInt(rawPage, 10);
	return page >= 1 && page <= PUBLIC_ORGANIZATION_MAX_PAGE ? page : null;
}

function isValidPublicOrganizationIdentifier(identifier: string): boolean {
	return (
		UUID_PATTERN.test(identifier) ||
		(identifier.length <= PUBLIC_ORGANIZATION_SEARCH_MAX_LENGTH &&
			isOrganizationSlug(identifier))
	);
}

function registerOrganizationSearchRoute(
	publicOrganizations: PublicOrganizationsApp,
	path: string,
) {
	publicOrganizations.get(path, async (c) => {
		const query = (c.req.query("query") ?? "").trim();
		const page = parsePublicOrganizationsPage(c.req.query("page") ?? null);

		if (page === null) {
			return jsonError(c, {
				code: "INVALID_REQUEST",
				message: "Organization search page must be a positive integer.",
				status: 400,
			});
		}

		if (query.length > PUBLIC_ORGANIZATION_SEARCH_MAX_LENGTH) {
			return jsonError(c, {
				code: "INVALID_REQUEST",
				message: "Organization search query is too long.",
				status: 400,
			});
		}

		return c.json({
			data: await searchPublicOrganizations({ page, query }),
			error: null,
		});
	});
}

function registerOrganizationDetailRoute(
	publicOrganizations: PublicOrganizationsApp,
	path: string,
) {
	publicOrganizations.get(path, async (c) => {
		const identifier = (c.req.param("identifier") ?? "").trim();

		if (!isValidPublicOrganizationIdentifier(identifier)) {
			return jsonError(c, {
				code: "INVALID_REQUEST",
				message: "Organization identifier must be a slug or ID.",
				status: 400,
			});
		}

		const organization = await getPublicOrganizationByIdentifier(identifier);

		if (!organization) {
			return jsonError(c, {
				code: "ORGANIZATION_NOT_FOUND",
				message: "The organization could not be found.",
				status: 404,
			});
		}

		return c.json({
			data: { organization },
			error: null,
		});
	});
}

export function registerPublicOrganizationRoutes(
	publicOrganizations: PublicOrganizationsApp,
): void {
	registerOrganizationSearchRoute(publicOrganizations, "/organizations");
	registerOrganizationDetailRoute(
		publicOrganizations,
		"/organizations/:identifier",
	);
	registerOrganizationSearchRoute(publicOrganizations, "/report-organizations");
	registerOrganizationDetailRoute(
		publicOrganizations,
		"/report-organizations/:identifier",
	);
}
