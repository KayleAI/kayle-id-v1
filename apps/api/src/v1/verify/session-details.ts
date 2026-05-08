import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import {
	isAgeOverClaim,
	parseAgeOverThreshold,
} from "@/v1/sessions/domain/share-contract/claim-catalog";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";

export type PublicVerifySessionDetails = {
	organization_name: string;
	organization_verified: boolean;
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

	return {
		organization_name: session.organizationName,
		organization_verified: session.organizationVerifiedAt !== null,
		session_id: session.sessionId,
		is_age_only: session.isAgeOnly,
		age_threshold: session.isAgeOnly
			? extractAgeThreshold(session.shareFields as ShareFields)
			: null,
	};
}
