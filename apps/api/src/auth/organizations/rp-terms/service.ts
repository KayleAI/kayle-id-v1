import { memberHasOwnerRoleSql } from "@kayle-id/auth/organization-role-sql";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organization_rp_terms_acceptances,
} from "@kayle-id/database/schema/auth";
import { and, eq, isNull } from "drizzle-orm";
import type { RpTermsAcceptanceRow } from "./types";

export const currentRpTerms = {
	jurisdiction: RP_INTEGRATION_TERMS_JURISDICTION,
	terms_hash: RP_INTEGRATION_TERMS_HASH,
	terms_version: RP_INTEGRATION_TERMS_VERSION,
} as const;

export type AcceptCurrentRpTermsResult =
	| { acceptance: RpTermsAcceptanceRow; kind: "accepted" }
	| { kind: "forbidden" }
	| { error: unknown; kind: "record_failed" };

export async function getCurrentAcceptance(
	organizationId: string,
): Promise<RpTermsAcceptanceRow | null> {
	const [acceptance] = await db
		.select({
			acceptedAt: auth_organization_rp_terms_acceptances.acceptedAt,
			acceptedBy: auth_organization_rp_terms_acceptances.acceptedBy,
			jurisdiction: auth_organization_rp_terms_acceptances.jurisdiction,
			termsHash: auth_organization_rp_terms_acceptances.termsHash,
			termsVersion: auth_organization_rp_terms_acceptances.termsVersion,
		})
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

	return acceptance ?? null;
}

export function toStatusResponse(acceptance: RpTermsAcceptanceRow | null) {
	return {
		acceptance: acceptance
			? {
					accepted_at: acceptance.acceptedAt.toISOString(),
					accepted_by: acceptance.acceptedBy,
					jurisdiction: acceptance.jurisdiction,
					terms_hash: acceptance.termsHash,
					terms_version: acceptance.termsVersion,
				}
			: null,
		current: currentRpTerms,
		current_accepted: Boolean(acceptance),
	};
}

async function ownerMembershipExists({
	organizationId,
	userId,
}: {
	organizationId: string;
	userId: string;
}): Promise<boolean> {
	const [membership] = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
				isNull(auth_organization_members.suspendedAt),
				memberHasOwnerRoleSql(),
			),
		)
		.limit(1);

	return Boolean(membership);
}

export async function acceptCurrentRpTerms({
	organizationId,
	userId,
}: {
	organizationId: string;
	userId: string;
}): Promise<AcceptCurrentRpTermsResult> {
	if (
		!(await ownerMembershipExists({
			organizationId,
			userId,
		}))
	) {
		return { kind: "forbidden" };
	}

	try {
		await db
			.insert(auth_organization_rp_terms_acceptances)
			.values({
				organizationId,
				termsVersion: RP_INTEGRATION_TERMS_VERSION,
				termsHash: RP_INTEGRATION_TERMS_HASH,
				jurisdiction: RP_INTEGRATION_TERMS_JURISDICTION,
				acceptedBy: userId,
			})
			.onConflictDoNothing({
				target: [
					auth_organization_rp_terms_acceptances.organizationId,
					auth_organization_rp_terms_acceptances.termsVersion,
					auth_organization_rp_terms_acceptances.termsHash,
					auth_organization_rp_terms_acceptances.jurisdiction,
				],
			});

		const acceptance = await getCurrentAcceptance(organizationId);
		if (!acceptance) {
			throw new Error("rp_terms_acceptance_missing_after_insert");
		}

		return { acceptance, kind: "accepted" };
	} catch (error) {
		return { error, kind: "record_failed" };
	}
}
