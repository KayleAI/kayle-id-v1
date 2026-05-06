import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";

export type PublicVerifySessionDetails = {
	organization_name: string;
	organization_verified: boolean;
	session_id: string;
	is_age_only: boolean;
};

export async function getPublicVerifySessionDetails({
	sessionId,
}: {
	sessionId: string;
}): Promise<PublicVerifySessionDetails | null> {
	const [session] = await db
		.select({
			organizationName: auth_organizations.name,
			organizationVerifiedAt: auth_organizations.verifiedAt,
			sessionId: verification_sessions.id,
			isAgeOnly: verification_sessions.isAgeOnly,
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
	};
}
