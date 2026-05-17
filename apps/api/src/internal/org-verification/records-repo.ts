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

export type PreparedOrgVerificationRecord = {
	candidateHashes: string[];
	dedupHash: string;
	pepperVersion: number;
};

async function computeCandidateHashes(
	candidate: DedupHashInput,
	env: PepperBinding,
): Promise<string[]> {
	const peppers = listActivePeppers(env);
	if (peppers.length === 0) {
		return [];
	}

	return Promise.all(
		peppers.map((pepper: ActivePepper) =>
			computeDedupHash(candidate, pepper.value),
		),
	);
}

export async function prepareOrgVerificationRecord(
	input: RecordVerificationInput,
	env: PepperBinding,
): Promise<PreparedOrgVerificationRecord> {
	const pepper = getCurrentPepper(env);
	const candidate = toHashInput(input);
	const [dedupHash, candidateHashes] = await Promise.all([
		computeDedupHash(candidate, pepper.value),
		computeCandidateHashes(candidate, env),
	]);

	return {
		dedupHash,
		pepperVersion: pepper.version,
		candidateHashes,
	};
}

/**
 * Compute the dedup hash for a candidate document, scoped to the org being
 * verified, and persist the row that proves the org owner completed an ID
 * check. Returns the inserted record + the hash so callers can immediately
 * branch on existing matches before recording the org owner's ID check.
 */
export async function recordOrgVerification(
	input: RecordVerificationInput,
	env: PepperBinding,
): Promise<RecordVerificationResult> {
	const prepared = await prepareOrgVerificationRecord(input, env);

	const [row] = await db
		.insert(org_verification_records)
		.values({
			organizationId: input.organizationId,
			dedupHash: prepared.dedupHash,
			pepperVersion: prepared.pepperVersion,
			documentType: input.documentType,
			issuingCountry: input.issuingCountry,
		})
		.returning({ id: org_verification_records.id });

	if (!row) {
		throw new Error("org_verification_record_insert_returned_no_row");
	}

	return {
		recordId: row.id,
		dedupHash: prepared.dedupHash,
		pepperVersion: prepared.pepperVersion,
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
	const candidateHashes = await computeCandidateHashes(candidate, env);
	if (candidateHashes.length === 0) {
		return [];
	}

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
