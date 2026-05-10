import { parseStoredOrganizationMetadata } from "@kayle-id/auth/organization-metadata";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import {
	isAgeOverClaim,
	parseAgeOverThreshold,
} from "@/v1/sessions/domain/share-contract/claim-catalog";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";
import { isPublicVerifySessionHidden } from "./public-session-visibility";

export type PublicVerifySessionDetails = {
	organization_name: string;
	organization_verified: boolean;
	organization_logo: string | null;
	organization_business_name: string | null;
	organization_business_jurisdiction: string | null;
	organization_business_registration_number: string | null;
	organization_privacy_policy_url: string | null;
	organization_terms_of_service_url: string | null;
	organization_website: string | null;
	organization_description: string | null;
	session_id: string;
	is_age_only: boolean;
	age_threshold: number | null;
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

	const metadata = parseStoredOrganizationMetadata(
		session.organizationMetadata,
	);

	return {
		organization_name: session.organizationName,
		organization_verified: session.organizationVerifiedAt !== null,
		organization_logo: session.organizationLogo,
		organization_business_name: session.organizationBusinessName,
		organization_business_jurisdiction:
			session.organizationBusinessJurisdiction,
		organization_business_registration_number:
			session.organizationBusinessRegistrationNumber,
		organization_privacy_policy_url: metadata?.privacyPolicyUrl ?? null,
		organization_terms_of_service_url: metadata?.termsOfServiceUrl ?? null,
		organization_website: metadata?.website ?? null,
		organization_description: metadata?.description ?? null,
		session_id: session.sessionId,
		is_age_only: session.isAgeOnly,
		age_threshold: session.isAgeOnly
			? extractAgeThreshold(session.shareFields as ShareFields)
			: null,
	};
}
