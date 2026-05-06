import { db } from "@kayle-id/database/drizzle";
import { org_verification_records } from "@kayle-id/database/schema/core";
import { inArray } from "drizzle-orm";
import {
	computeDedupHash,
	type DedupHashInput,
	type OrgVerificationDocumentType,
} from "./dedup";
import {
	type ActivePepper,
	getCurrentPepper,
	listActivePeppers,
	type PepperBinding,
} from "./pepper";

export type RecordVerificationInput = {
	organizationId: string;
	documentType: OrgVerificationDocumentType;
	documentNumber: string;
	issuingCountry: string;
};

export type RecordVerificationResult = {
	recordId: string;
	dedupHash: string;
	pepperVersion: number;
};

/**
 * Compute the dedup hash for a candidate document, scoped to the org being
 * verified, and persist the row that proves the org owner completed an ID
 * check. Returns the inserted record + the hash so callers can immediately
 * branch on existing matches before flipping the org's `verifiedAt`.
 */
export async function recordOrgVerification(
	input: RecordVerificationInput,
	env: PepperBinding,
): Promise<RecordVerificationResult> {
	const pepper = getCurrentPepper(env);
	const dedupHash = await computeDedupHash(toHashInput(input), pepper.value);

	const [row] = await db
		.insert(org_verification_records)
		.values({
			organizationId: input.organizationId,
			dedupHash,
			pepperVersion: pepper.version,
			documentType: input.documentType,
			issuingCountry: input.issuingCountry,
		})
		.returning({ id: org_verification_records.id });

	if (!row) {
		throw new Error("org_verification_record_insert_returned_no_row");
	}

	return {
		recordId: row.id,
		dedupHash,
		pepperVersion: pepper.version,
	};
}

/**
 * Find any existing record(s) matching the candidate document under any
 * currently-active pepper. Lookups MUST iterate every version because new
 * writes only use the current pepper — older rows still need to be findable
 * during the rotation grace period.
 */
export async function findRecordsByDocument(
	candidate: DedupHashInput,
	env: PepperBinding,
): Promise<(typeof org_verification_records.$inferSelect)[]> {
	const peppers = listActivePeppers(env);
	if (peppers.length === 0) {
		return [];
	}

	const candidateHashes = await Promise.all(
		peppers.map((pepper: ActivePepper) =>
			computeDedupHash(candidate, pepper.value),
		),
	);

	return db
		.select()
		.from(org_verification_records)
		.where(inArray(org_verification_records.dedupHash, candidateHashes));
}

function toHashInput(input: RecordVerificationInput): DedupHashInput {
	return {
		documentType: input.documentType,
		documentNumber: input.documentNumber,
		issuingCountry: input.issuingCountry,
	};
}
