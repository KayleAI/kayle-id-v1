import { memberHasOwnerRoleSql } from "@kayle-id/auth/organization-role-sql";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { org_verification_records } from "@kayle-id/database/schema/core";
import { and, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import type {
	FinalizeOrgVerificationInput,
	FinalizeResult,
	FinalizeTarget,
} from "./finalize-types";
import type { PreparedOrgVerificationRecord } from "./records-repo";

export async function loadFinalizeTarget(
	organizationId: string,
): Promise<FinalizeTarget> {
	const [org] = await db
		.select({
			id: auth_organizations.id,
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			verifiedAt: auth_organizations.owner_id_checked_at,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);

	if (!org) {
		return { kind: "not_found" };
	}

	if (org.verifiedAt) {
		return {
			kind: "already_verified",
			organizationId: org.id,
			verifiedAt: org.verifiedAt,
		};
	}

	if (org.pendingDeletionAt) {
		return { kind: "frozen" };
	}

	return { kind: "ready", organizationId: org.id };
}

export function inputFromFinalizeBody(body: {
	organization_id: string;
	document_type: FinalizeOrgVerificationInput["documentType"];
	document_number: string;
	issuing_country: string;
	owner_user_id: string;
}): FinalizeOrgVerificationInput {
	return {
		organizationId: body.organization_id,
		documentType: body.document_type,
		documentNumber: body.document_number,
		issuingCountry: body.issuing_country,
		ownerUserId: body.owner_user_id,
	};
}

export async function finalizePreparedOrgVerification({
	input,
	preparedRecord,
	now,
}: {
	input: FinalizeOrgVerificationInput;
	preparedRecord: PreparedOrgVerificationRecord;
	now: Date;
}): Promise<FinalizeResult> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${preparedRecord.dedupHash}::text, 2))`,
		);

		const [existingRecord] = await tx
			.select({
				id: org_verification_records.id,
				dedupHash: org_verification_records.dedupHash,
				organizationId: org_verification_records.organizationId,
				pepperVersion: org_verification_records.pepperVersion,
			})
			.from(org_verification_records)
			.where(
				inArray(
					org_verification_records.dedupHash,
					preparedRecord.candidateHashes,
				),
			)
			.limit(1);

		if (
			existingRecord &&
			existingRecord.organizationId !== input.organizationId
		) {
			return {
				kind: "document_conflict",
				recordOrganizationId: existingRecord.organizationId,
			};
		}

		const [updatedOrg] = await tx
			.update(auth_organizations)
			.set({ owner_id_checked_at: now })
			.where(
				and(
					eq(auth_organizations.id, input.organizationId),
					isNull(auth_organizations.owner_id_checked_at),
					isNull(auth_organizations.pending_deletion_at),
					exists(
						tx
							.select({ presence: sql`1` })
							.from(auth_organization_members)
							.where(
								and(
									eq(
										auth_organization_members.organizationId,
										auth_organizations.id,
									),
									eq(auth_organization_members.userId, input.ownerUserId),
									isNull(auth_organization_members.suspendedAt),
									memberHasOwnerRoleSql(),
								),
							),
					),
				),
			)
			.returning({
				verifiedAt: auth_organizations.owner_id_checked_at,
			});

		if (!updatedOrg?.verifiedAt) {
			return resolveUnchangedOrganization(tx, input.organizationId);
		}

		if (existingRecord) {
			return {
				alreadyVerified: false,
				dedupHash: existingRecord.dedupHash,
				kind: "verified",
				pepperVersion: existingRecord.pepperVersion,
				recordId: existingRecord.id,
				verifiedAt: updatedOrg.verifiedAt,
			};
		}

		const [recordRow] = await tx
			.insert(org_verification_records)
			.values({
				organizationId: input.organizationId,
				dedupHash: preparedRecord.dedupHash,
				pepperVersion: preparedRecord.pepperVersion,
				documentType: input.documentType,
				issuingCountry: input.issuingCountry,
			})
			.returning({ id: org_verification_records.id });

		if (!recordRow) {
			throw new Error("org_verification_record_insert_returned_no_row");
		}

		return {
			alreadyVerified: false,
			dedupHash: preparedRecord.dedupHash,
			kind: "verified",
			pepperVersion: preparedRecord.pepperVersion,
			recordId: recordRow.id,
			verifiedAt: updatedOrg.verifiedAt,
		};
	});
}

async function resolveUnchangedOrganization(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	organizationId: string,
): Promise<FinalizeResult> {
	const [currentOrg] = await tx
		.select({
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			verifiedAt: auth_organizations.owner_id_checked_at,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);

	if (currentOrg?.verifiedAt) {
		return {
			alreadyVerified: true,
			kind: "already_verified",
			verifiedAt: currentOrg.verifiedAt,
		};
	}

	if (currentOrg?.pendingDeletionAt) {
		return { kind: "frozen" };
	}

	return { kind: "owner_not_active" };
}
