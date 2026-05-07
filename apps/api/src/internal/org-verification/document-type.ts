import type { OrgVerificationDocumentType } from "./dedup";

/**
 * Map a raw MRZ document type code (DG1) onto the enum we record in the
 * dedup table. The current verify pipeline only accepts TD3 passports, so in
 * practice this always returns `"passport"` today; the wider mapping is here
 * so we don't need to revisit dedup when TD1/TD2 ID cards land.
 */
export function mapMrzDocumentTypeToEnum(
	documentTypeCode: string,
): OrgVerificationDocumentType {
	const code = documentTypeCode.trim().toUpperCase();
	if (code.startsWith("P")) {
		return "passport";
	}
	if (code.startsWith("IR") || code.startsWith("AR")) {
		return "residence_permit";
	}
	if (code.startsWith("I") || code.startsWith("A") || code.startsWith("C")) {
		return "national_id";
	}
	return "other";
}
