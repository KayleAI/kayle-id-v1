import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq } from "drizzle-orm";

export type PublicVerifySessionDetails = {
	organization_name: string;
	session_id: string;
};

export async function getPublicVerifySessionDetails({
	sessionId,
}: {
	sessionId: string;
}): Promise<PublicVerifySessionDetails | null> {
	const [session] = await db
		.select({
			organizationName: auth_organizations.name,
			sessionId: verification_sessions.id,
		})
		.from(verification_sessions)
		.innerJoin(
			auth_organizations,
			eq(auth_organizations.id, verification_sessions.organizationId),
		)
		.where(
			and(
				eq(verification_sessions.id, sessionId),
				eq(verification_sessions.environment, "live"),
			),
		)
		.limit(1);

	if (!session) {
		return null;
	}

	return {
		organization_name: session.organizationName,
		session_id: session.sessionId,
	};
}
