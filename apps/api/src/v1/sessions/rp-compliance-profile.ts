import {
	getOrganizationComplianceProfileStatus,
	parseStoredOrganizationMetadata,
} from "@kayle-id/auth/organization-metadata";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";

export type RpComplianceProfileGateResult =
	| { ok: true }
	| { ok: false; missingFields: string[] };

export function shouldEnforceRpComplianceProfile(): boolean {
	return process.env.NODE_ENV === "production";
}

export async function checkRpComplianceProfileGate({
	organizationId,
}: {
	organizationId: string;
}): Promise<RpComplianceProfileGateResult> {
	if (!shouldEnforceRpComplianceProfile()) {
		return { ok: true };
	}

	const [organization] = await db
		.select({ metadata: auth_organizations.metadata })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);
	const metadata = parseStoredOrganizationMetadata(organization?.metadata);
	const profileStatus = getOrganizationComplianceProfileStatus(metadata);

	if (profileStatus.complete) {
		return { ok: true };
	}

	return {
		ok: false,
		missingFields: profileStatus.missingFields,
	};
}
