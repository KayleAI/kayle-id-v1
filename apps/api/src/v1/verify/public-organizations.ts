import { parseStoredOrganizationMetadata } from "@kayle-id/auth/organization-metadata";
import { isOrganizationSlug } from "@kayle-id/auth/organization-slug";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_rp_terms_acceptances,
	auth_organization_verified_domains,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import {
	and,
	asc,
	eq,
	exists,
	ilike,
	inArray,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { type Context, Hono } from "hono";

const publicOrganizations = new Hono<{ Bindings: CloudflareBindings }>();

const PUBLIC_ORGANIZATION_SEARCH_LIMIT = 10;
const PUBLIC_ORGANIZATION_MAX_PAGE = 1000;
const PUBLIC_ORGANIZATION_SEARCH_MAX_LENGTH = 100;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type PublicOrganizationsPage = {
	has_next_page: boolean;
	has_previous_page: boolean;
	page: number;
	page_size: number;
};

type PublicOrganizationRow = {
	businessJurisdiction: null | string;
	businessName: null | string;
	businessRegistrationNumber: null | string;
	businessType: "business" | "sole" | null;
	id: string;
	logo: null | string;
	metadata: null | string;
	name: string;
	ownerIdCheckedAt: Date | null;
	slug: string;
};

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

function escapeIlikeWildcards(input: string): string {
	return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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

function currentIntegrationTermsAcceptedPredicate() {
	return exists(
		db
			.select({ presence: sql`1` })
			.from(auth_organization_rp_terms_acceptances)
			.where(
				and(
					eq(
						auth_organization_rp_terms_acceptances.organizationId,
						auth_organizations.id,
					),
					eq(
						auth_organization_rp_terms_acceptances.termsVersion,
						RP_INTEGRATION_TERMS_VERSION,
					),
					eq(
						auth_organization_rp_terms_acceptances.termsHash,
						RP_INTEGRATION_TERMS_HASH,
					),
					eq(
						auth_organization_rp_terms_acceptances.jurisdiction,
						RP_INTEGRATION_TERMS_JURISDICTION,
					),
				),
			),
	);
}

async function fetchVerifiedApexDomainsByOrganizationIds(
	organizationIds: string[],
): Promise<Map<string, string[]>> {
	const domainsByOrganizationId = new Map<string, string[]>();

	if (organizationIds.length === 0) {
		return domainsByOrganizationId;
	}

	const domains = await db
		.select({
			apexDomain: auth_organization_verified_domains.apexDomain,
			organizationId: auth_organization_verified_domains.organizationId,
		})
		.from(auth_organization_verified_domains)
		.where(
			and(
				inArray(
					auth_organization_verified_domains.organizationId,
					organizationIds,
				),
				isNull(auth_organization_verified_domains.downgradedAt),
			),
		)
		.orderBy(
			asc(auth_organization_verified_domains.organizationId),
			asc(auth_organization_verified_domains.apexDomain),
		);

	for (const domain of domains) {
		const existing = domainsByOrganizationId.get(domain.organizationId) ?? [];
		existing.push(domain.apexDomain);
		domainsByOrganizationId.set(domain.organizationId, existing);
	}

	return domainsByOrganizationId;
}

function serializePublicOrganization(
	organization: PublicOrganizationRow,
	domainsByOrganizationId: Map<string, string[]>,
) {
	const verifiedApexDomains =
		domainsByOrganizationId.get(organization.id) ?? [];
	const metadata = parseStoredOrganizationMetadata(organization.metadata);
	const businessFieldsAllowed = verifiedApexDomains.length > 0;

	return {
		business_jurisdiction: businessFieldsAllowed
			? organization.businessJurisdiction
			: null,
		business_name: businessFieldsAllowed ? organization.businessName : null,
		business_registration_number: businessFieldsAllowed
			? organization.businessRegistrationNumber
			: null,
		business_type: businessFieldsAllowed ? organization.businessType : null,
		description: metadata?.description ?? null,
		id: organization.id,
		integration_terms_accepted: true,
		logo: businessFieldsAllowed ? organization.logo : null,
		name: organization.name,
		owner_id_check_completed: organization.ownerIdCheckedAt !== null,
		privacy_policy_url: metadata?.privacyPolicyUrl ?? null,
		rp_fallback: {
			appeal_url: metadata?.appealUrl ?? null,
			complaints_url: metadata?.complaintsUrl ?? null,
			fallback_idv_url: metadata?.fallbackIdvUrl ?? null,
			support_email: metadata?.supportEmail ?? null,
		},
		slug: organization.slug,
		terms_of_service_url: metadata?.termsOfServiceUrl ?? null,
		verified_apex_domains: verifiedApexDomains,
		website: metadata?.website ?? null,
	};
}

function selectPublicOrganizationFields() {
	return {
		businessJurisdiction: auth_organizations.business_jurisdiction,
		businessName: auth_organizations.business_name,
		businessRegistrationNumber: auth_organizations.business_registration_number,
		businessType: auth_organizations.business_type,
		id: auth_organizations.id,
		logo: auth_organizations.logo,
		metadata: auth_organizations.metadata,
		name: auth_organizations.name,
		ownerIdCheckedAt: auth_organizations.owner_id_checked_at,
		slug: auth_organizations.slug,
	};
}

export async function searchPublicOrganizations({
	page,
	query,
}: {
	page: number;
	query: string;
}): Promise<{
	organizations: ReturnType<typeof serializePublicOrganization>[];
	pagination: PublicOrganizationsPage;
}> {
	const normalizedQuery = query.trim();
	const isUuid = UUID_PATTERN.test(normalizedQuery);
	const predicates = [
		isNull(auth_organizations.pending_deletion_at),
		currentIntegrationTermsAcceptedPredicate(),
	];

	if (normalizedQuery) {
		const escapedQuery = escapeIlikeWildcards(normalizedQuery);
		const searchPattern = `%${escapedQuery}%`;
		const searchPredicates = [
			ilike(auth_organizations.name, searchPattern),
			ilike(auth_organizations.slug, searchPattern),
			exists(
				db
					.select({ presence: sql`1` })
					.from(auth_organization_verified_domains)
					.where(
						and(
							eq(
								auth_organization_verified_domains.organizationId,
								auth_organizations.id,
							),
							isNull(auth_organization_verified_domains.downgradedAt),
							ilike(
								auth_organization_verified_domains.apexDomain,
								searchPattern,
							),
						),
					),
			),
		];

		if (isUuid) {
			searchPredicates.push(eq(auth_organizations.id, normalizedQuery));
		}

		const searchPredicate = or(...searchPredicates);
		if (searchPredicate) {
			predicates.push(searchPredicate);
		}
	}

	const rows = await db
		.select(selectPublicOrganizationFields())
		.from(auth_organizations)
		.where(and(...predicates))
		.orderBy(
			asc(sql`lower(${auth_organizations.name})`),
			asc(sql`lower(${auth_organizations.slug})`),
		)
		.limit(PUBLIC_ORGANIZATION_SEARCH_LIMIT + 1)
		.offset((page - 1) * PUBLIC_ORGANIZATION_SEARCH_LIMIT);

	const visibleRows = rows.slice(0, PUBLIC_ORGANIZATION_SEARCH_LIMIT);

	const domainsByOrganizationId =
		await fetchVerifiedApexDomainsByOrganizationIds(
			visibleRows.map((row) => row.id),
		);

	return {
		organizations: visibleRows.map((row) =>
			serializePublicOrganization(row, domainsByOrganizationId),
		),
		pagination: {
			has_next_page: rows.length > PUBLIC_ORGANIZATION_SEARCH_LIMIT,
			has_previous_page: page > 1,
			page,
			page_size: PUBLIC_ORGANIZATION_SEARCH_LIMIT,
		},
	};
}

export async function getPublicOrganizationByIdentifier(identifier: string) {
	const isUuid = UUID_PATTERN.test(identifier);
	const [organization] = await db
		.select(selectPublicOrganizationFields())
		.from(auth_organizations)
		.where(
			and(
				isNull(auth_organizations.pending_deletion_at),
				currentIntegrationTermsAcceptedPredicate(),
				isUuid
					? eq(auth_organizations.id, identifier)
					: eq(auth_organizations.slug, identifier.toLowerCase()),
			),
		)
		.limit(1);

	if (!organization) {
		return null;
	}

	const domainsByOrganizationId =
		await fetchVerifiedApexDomainsByOrganizationIds([organization.id]);

	return serializePublicOrganization(organization, domainsByOrganizationId);
}

function isValidPublicOrganizationIdentifier(identifier: string): boolean {
	return (
		UUID_PATTERN.test(identifier) ||
		(identifier.length <= PUBLIC_ORGANIZATION_SEARCH_MAX_LENGTH &&
			isOrganizationSlug(identifier))
	);
}

function registerOrganizationSearchRoute(path: string) {
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

function registerOrganizationDetailRoute(path: string) {
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

registerOrganizationSearchRoute("/organizations");
registerOrganizationDetailRoute("/organizations/:identifier");
registerOrganizationSearchRoute("/report-organizations");
registerOrganizationDetailRoute("/report-organizations/:identifier");

export default publicOrganizations;
