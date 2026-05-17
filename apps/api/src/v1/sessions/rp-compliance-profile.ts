import {
	getOrganizationComplianceProfileStatus,
	parseStoredOrganizationMetadata,
} from "@kayle-id/auth/organization-metadata";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_rp_terms_acceptances,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";

export type RpComplianceProfileGateResult =
	| { ok: true }
	| {
			ok: false;
			missingFields: string[];
			reason: "profile_and_terms_incomplete" | "profile_incomplete";
	  }
	| {
			ok: false;
			missingFields: ["rpIntegrationTermsAcceptance"];
			reason: "terms_not_accepted";
	  };

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
	const [currentTermsAcceptance] = await db
		.select({ id: auth_organization_rp_terms_acceptances.id })
		.from(auth_organization_rp_terms_acceptances)
		.where(
			and(
				eq(
					auth_organization_rp_terms_acceptances.organizationId,
					organizationId,
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
		)
		.limit(1);

	if (profileStatus.complete && currentTermsAcceptance) {
		return { ok: true };
	}

	if (profileStatus.complete) {
		return {
			ok: false,
			missingFields: ["rpIntegrationTermsAcceptance"],
			reason: "terms_not_accepted",
		};
	}

	if (!currentTermsAcceptance) {
		return {
			ok: false,
			missingFields: [
				...profileStatus.missingFields,
				"rpIntegrationTermsAcceptance",
			],
			reason: "profile_and_terms_incomplete",
		};
	}

	return {
		ok: false,
		missingFields: profileStatus.missingFields,
		reason: "profile_incomplete",
	};
}
