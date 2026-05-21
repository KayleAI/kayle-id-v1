import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { memberHasOwnerRoleSql } from "@kayle-id/auth/organization-role-sql";
import { hasOrgRole } from "@kayle-id/auth/permissions";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import type { AcceptedVerificationTerms } from "./types";

export type AcceptVerificationTermsResult =
	| ({ kind: "accepted" } & AcceptedVerificationTerms)
	| { kind: "already_verified" }
	| { kind: "forbidden" }
	| { kind: "not_found" }
	| { kind: "organization_frozen"; message: string }
	| { kind: "record_failed"; error: unknown };

type OrganizationTermsState = {
	id: string;
	verifiedAt: Date | null;
	verificationTermsAcceptedAt: Date | null;
	verificationTermsAcceptedBy: string | null;
};

function acceptedResult({
	verificationTermsAcceptedAt,
	verificationTermsAcceptedBy,
}: {
	verificationTermsAcceptedAt: Date;
	verificationTermsAcceptedBy: string;
}): AcceptVerificationTermsResult {
	return {
		kind: "accepted",
		verificationTermsAcceptedAt,
		verificationTermsAcceptedBy,
	};
}

async function loadOrganizationTermsState(
	organizationId: string,
): Promise<OrganizationTermsState | null> {
	const [org] = await db
		.select({
			id: auth_organizations.id,
			verifiedAt: auth_organizations.owner_id_checked_at,
			verificationTermsAcceptedAt:
				auth_organizations.verification_terms_accepted_at,
			verificationTermsAcceptedBy:
				auth_organizations.verification_terms_accepted_by,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);

	return org ?? null;
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
			),
		)
		.limit(1);

	return Boolean(membership && hasOrgRole(membership.role, "owner"));
}

function existingAcceptanceResult(
	state: Pick<
		OrganizationTermsState,
		"verificationTermsAcceptedAt" | "verificationTermsAcceptedBy"
	>,
): AcceptVerificationTermsResult | null {
	if (state.verificationTermsAcceptedAt && state.verificationTermsAcceptedBy) {
		return acceptedResult({
			verificationTermsAcceptedAt: state.verificationTermsAcceptedAt,
			verificationTermsAcceptedBy: state.verificationTermsAcceptedBy,
		});
	}

	return null;
}

async function recordTermsAcceptance({
	now,
	organizationId,
	userId,
}: {
	now: Date;
	organizationId: string;
	userId: string;
}): Promise<AcceptVerificationTermsResult | null> {
	const [accepted] = await db
		.update(auth_organizations)
		.set({
			verification_terms_accepted_at: now,
			verification_terms_accepted_by: userId,
		})
		.where(
			and(
				eq(auth_organizations.id, organizationId),
				isNull(auth_organizations.owner_id_checked_at),
				isNull(auth_organizations.pending_deletion_at),
				or(
					isNull(auth_organizations.verification_terms_accepted_at),
					isNull(auth_organizations.verification_terms_accepted_by),
				),
				exists(
					db
						.select({ presence: sql`1` })
						.from(auth_organization_members)
						.where(
							and(
								eq(
									auth_organization_members.organizationId,
									auth_organizations.id,
								),
								eq(auth_organization_members.userId, userId),
								isNull(auth_organization_members.suspendedAt),
								memberHasOwnerRoleSql(),
							),
						),
				),
			),
		)
		.returning({
			verificationTermsAcceptedAt:
				auth_organizations.verification_terms_accepted_at,
			verificationTermsAcceptedBy:
				auth_organizations.verification_terms_accepted_by,
		});

	if (
		accepted?.verificationTermsAcceptedAt &&
		accepted.verificationTermsAcceptedBy
	) {
		return acceptedResult({
			verificationTermsAcceptedAt: accepted.verificationTermsAcceptedAt,
			verificationTermsAcceptedBy: accepted.verificationTermsAcceptedBy,
		});
	}

	return null;
}

async function loadLatestFallbackResult(
	organizationId: string,
): Promise<AcceptVerificationTermsResult> {
	const [latestOrg] = await db
		.select({
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			verifiedAt: auth_organizations.owner_id_checked_at,
			verificationTermsAcceptedAt:
				auth_organizations.verification_terms_accepted_at,
			verificationTermsAcceptedBy:
				auth_organizations.verification_terms_accepted_by,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);

	if (!latestOrg) {
		return { kind: "not_found" };
	}

	if (latestOrg.verifiedAt) {
		return { kind: "already_verified" };
	}

	if (latestOrg.pendingDeletionAt) {
		return {
			kind: "organization_frozen",
			message:
				"Organization is scheduled for deletion. Cancel the deletion before accepting verification terms.",
		};
	}

	return existingAcceptanceResult(latestOrg) ?? { kind: "forbidden" };
}

export async function acceptVerificationTermsForOwner({
	organizationId,
	userId,
}: {
	organizationId: string;
	userId: string;
}): Promise<AcceptVerificationTermsResult> {
	try {
		await assertOrgNotFrozen(organizationId);
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return { kind: "organization_frozen", message: error.message };
		}
		throw error;
	}

	const org = await loadOrganizationTermsState(organizationId);
	if (!org) {
		return { kind: "not_found" };
	}

	if (org.verifiedAt) {
		return { kind: "already_verified" };
	}

	if (
		!(await ownerMembershipExists({
			organizationId,
			userId,
		}))
	) {
		return { kind: "forbidden" };
	}

	const existingAcceptance = existingAcceptanceResult(org);
	if (existingAcceptance) {
		return existingAcceptance;
	}

	try {
		const accepted = await recordTermsAcceptance({
			now: new Date(),
			organizationId,
			userId,
		});

		if (accepted) {
			return accepted;
		}
	} catch (error) {
		return { kind: "record_failed", error };
	}

	return loadLatestFallbackResult(organizationId);
}
