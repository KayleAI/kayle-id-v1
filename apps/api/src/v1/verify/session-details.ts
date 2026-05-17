import { parseStoredOrganizationMetadata } from "@kayle-id/auth/organization-metadata";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_verified_domains,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
	isAgeOverClaim,
	parseAgeOverThreshold,
} from "@/v1/sessions/domain/share-contract/claim-catalog";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";
import { isPublicVerifySessionHidden } from "./public-session-visibility";
import { resolvePublicShareFields } from "./public-share-fields";

export type PublicVerifySessionDetails = {
	organization_name: string;
	organization_owner_id_check_completed: boolean;
	/**
	 * All apex domains the org has actively verified, sorted alphabetically
	 * for stable display. Empty when the org has no active verifications.
	 * Used by the verify UI both to gate self-asserted business fields
	 * (any verified apex unlocks them) and to decide whether the verified-
	 * domain badge is appropriate (every policy/website link must point
	 * at one of these apexes — that check happens client-side).
	 */
	organization_verified_apex_domains: string[];
	organization_logo: string | null;
	/**
	 * `"sole"` (sole trader / individual) → relabel the business fields in
	 * the verify-flow dialog to the individual-equivalents (Full name /
	 * Country / Tax or trader ID). `"business"` or `null` (default) keeps
	 * the registered-entity labels.
	 */
	organization_business_type: "sole" | "business" | null;
	organization_business_name: string | null;
	organization_business_jurisdiction: string | null;
	organization_business_registration_number: string | null;
	organization_privacy_policy_url: string | null;
	organization_terms_of_service_url: string | null;
	organization_website: string | null;
	organization_description: string | null;
	rp_fallback: {
		appeal_url: string | null;
		complaints_url: string | null;
		fallback_idv_url: string | null;
		support_email: string | null;
	};
	session_id: string;
	is_age_only: boolean;
	age_threshold: number | null;
	share_fields: ShareFields;
};

function extractAgeThreshold(shareFields: ShareFields): number | null {
	for (const key of Object.keys(shareFields)) {
		if (!isAgeOverClaim(key)) {
			continue;
		}
		const threshold = parseAgeOverThreshold(key);
		if (threshold !== null) {
			return threshold;
		}
	}
	return null;
}

export async function getPublicVerifySessionDetails({
	sessionId,
}: {
	sessionId: string;
}): Promise<PublicVerifySessionDetails | null> {
	const [session] = await db
		.select({
			organizationName: auth_organizations.name,
			organizationVerifiedAt: auth_organizations.verified_at,
			organizationLogo: auth_organizations.logo,
			organizationBusinessType: auth_organizations.businessType,
			organizationBusinessName: auth_organizations.business_name,
			organizationBusinessJurisdiction:
				auth_organizations.business_jurisdiction,
			organizationBusinessRegistrationNumber:
				auth_organizations.business_registration_number,
			organizationMetadata: auth_organizations.metadata,
			organizationId: verification_sessions.organizationId,
			sessionId: verification_sessions.id,
			isAgeOnly: verification_sessions.isAgeOnly,
			shareFields: verification_sessions.shareFields,
		})
		.from(verification_sessions)
		.innerJoin(
			auth_organizations,
			eq(auth_organizations.id, verification_sessions.organizationId),
		)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!session) {
		return null;
	}

	if (await isPublicVerifySessionHidden(session.organizationId)) {
		return null;
	}

	const verifiedDomains = await db
		.select({
			apexDomain: auth_organization_verified_domains.apexDomain,
		})
		.from(auth_organization_verified_domains)
		.where(
			and(
				eq(
					auth_organization_verified_domains.organizationId,
					session.organizationId,
				),
				isNull(auth_organization_verified_domains.downgradedAt),
			),
		)
		.orderBy(asc(auth_organization_verified_domains.apexDomain));

	const verifiedApexDomains = verifiedDomains.map((row) => row.apexDomain);
	const metadata = parseStoredOrganizationMetadata(
		session.organizationMetadata,
	);

	const businessFieldsAllowed = verifiedApexDomains.length > 0;
	const shareFields = resolvePublicShareFields(session.shareFields);

	return {
		organization_name: session.organizationName,
		organization_owner_id_check_completed:
			session.organizationVerifiedAt !== null,
		organization_verified_apex_domains: verifiedApexDomains,
		organization_logo: businessFieldsAllowed ? session.organizationLogo : null,
		organization_business_type: businessFieldsAllowed
			? session.organizationBusinessType
			: null,
		organization_business_name: businessFieldsAllowed
			? session.organizationBusinessName
			: null,
		organization_business_jurisdiction: businessFieldsAllowed
			? session.organizationBusinessJurisdiction
			: null,
		organization_business_registration_number: businessFieldsAllowed
			? session.organizationBusinessRegistrationNumber
			: null,
		organization_privacy_policy_url: metadata?.privacyPolicyUrl ?? null,
		organization_terms_of_service_url: metadata?.termsOfServiceUrl ?? null,
		organization_website: metadata?.website ?? null,
		organization_description: metadata?.description ?? null,
		rp_fallback: {
			appeal_url: metadata?.appealUrl ?? null,
			complaints_url: metadata?.complaintsUrl ?? null,
			fallback_idv_url: metadata?.fallbackIdvUrl ?? null,
			support_email: metadata?.supportEmail ?? null,
		},
		session_id: session.sessionId,
		is_age_only: session.isAgeOnly,
		age_threshold: session.isAgeOnly ? extractAgeThreshold(shareFields) : null,
		share_fields: shareFields,
	};
}
