import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import type { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import type { Dg1Claims } from "@/v1/verify/dg1-claims";
import { mapMrzDocumentTypeToEnum } from "./document-type";
import { recordOrgVerification } from "./records-repo";

export type FinalizeOrgVerificationResult =
	| { kind: "not_owner_verification" }
	| { kind: "already_verified" }
	| { kind: "verified"; recordId: string; dedupHash: string };

/**
 * Finalize the owner-verification side effects for a successfully-completed
 * verification session. Writes the dedup hash row + flips `verified_at` on
 * the target organization. No-op for sessions that aren't tagged with
 * `ownerVerificationOrgId`.
 *
 * Must run AFTER `markAttemptSucceeded` so that an upstream failure leaves
 * the org unverified.
 */
export async function finalizeOrgVerificationIfApplicable({
	session,
	dg1Claims,
	env,
}: {
	session: typeof verification_sessions.$inferSelect;
	dg1Claims: Dg1Claims;
	env: Record<string, string | undefined>;
}): Promise<FinalizeOrgVerificationResult> {
	const targetOrgId = session.ownerVerificationOrgId;
	if (!targetOrgId) {
		return { kind: "not_owner_verification" };
	}

	const [org] = await db
		.select({
			verifiedAt: auth_organizations.verifiedAt,
			verificationTermsAcceptedAt:
				auth_organizations.verificationTermsAcceptedAt,
			verificationTermsAcceptedBy:
				auth_organizations.verificationTermsAcceptedBy,
		})
		.from(auth_organizations)
		.where(eq(auth_organizations.id, targetOrgId))
		.limit(1);

	if (!org) {
		return { kind: "not_owner_verification" };
	}

	if (org.verifiedAt) {
		return { kind: "already_verified" };
	}

	const documentType = mapMrzDocumentTypeToEnum(dg1Claims.documentType);
	const documentNumber = dg1Claims.documentNumber;
	const issuingCountry = dg1Claims.issuingCountry;

	const result = await recordOrgVerification(
		{
			organizationId: targetOrgId,
			documentType,
			documentNumber,
			issuingCountry,
		},
		env,
	);

	const now = new Date();
	await db
		.update(auth_organizations)
		.set({
			verifiedAt: now,
			// Terms-accepted timestamps were captured by the platform when the
			// owner submitted the business-details + ToS form. We only fall back
			// to writing them here if the platform skipped that step (e.g. legacy
			// data) so the org always has a defensible acceptance trail.
			verificationTermsAcceptedAt: org.verificationTermsAcceptedAt ?? now,
		})
		.where(eq(auth_organizations.id, targetOrgId));

	return {
		kind: "verified",
		recordId: result.recordId,
		dedupHash: result.dedupHash,
	};
}
