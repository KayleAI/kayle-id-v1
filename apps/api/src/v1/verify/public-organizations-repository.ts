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
import {
	PUBLIC_ORGANIZATION_SEARCH_LIMIT,
	UUID_PATTERN,
} from "./public-organizations-config";
import { serializePublicOrganization } from "./public-organizations-serializer";
import type {
	PublicOrganizationRow,
	PublicOrganizationsPage,
} from "./public-organizations-types";

function escapeIlikeWildcards(input: string): string {
	return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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

function publicOrganizationBasePredicates() {
	return [
		isNull(auth_organizations.pending_deletion_at),
		currentIntegrationTermsAcceptedPredicate(),
	];
}

function publicOrganizationSearchPredicate(query: string) {
	const escapedQuery = escapeIlikeWildcards(query);
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
						ilike(auth_organization_verified_domains.apexDomain, searchPattern),
					),
				),
		),
	];

	if (UUID_PATTERN.test(query)) {
		searchPredicates.push(eq(auth_organizations.id, query));
	}

	return or(...searchPredicates);
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
	const predicates = publicOrganizationBasePredicates();

	if (normalizedQuery) {
		const searchPredicate = publicOrganizationSearchPredicate(normalizedQuery);
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
		organizations: visibleRows.map((row: PublicOrganizationRow) =>
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
				...publicOrganizationBasePredicates(),
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
