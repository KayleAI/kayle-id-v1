import type { orgVerificationDocumentTypes } from "@kayle-id/database/schema/core";

/**
 * Field separator used inside the hash input to make the boundary between
 * (document_type, document_number, issuing_country) unambiguous. Picked so it
 * cannot appear in any of the inputs after normalization.
 */
const FIELD_SEPARATOR = "|";

export const ISSUING_COUNTRY_CODE_PATTERN = /^[A-Z]{3}$/;

const WHITESPACE_OR_HYPHEN = /[\s-]+/g;

/**
 * Normalize a raw document number for hashing. Strips whitespace + hyphens and
 * uppercases. Same value must be produced regardless of how the document was
 * printed: `AB123456`, `ab123456`, `AB 123456`, `AB-123-456` all collapse to
 * `AB123456`.
 */
export function normalizeDocumentNumber(value: string): string {
	return value.replace(WHITESPACE_OR_HYPHEN, "").toUpperCase();
}

/**
 * Validate + uppercase an issuing country code. Always store + hash the ISO
 * 3166-1 alpha-3 form.
 */
export function normalizeIssuingCountry(value: string): string {
	const trimmed = value.trim().toUpperCase();
	if (!ISSUING_COUNTRY_CODE_PATTERN.test(trimmed)) {
		throw new Error(
			"issuing_country must be a 3-letter ISO 3166-1 alpha-3 code.",
		);
	}
	return trimmed;
}

export type OrgVerificationDocumentType =
	(typeof orgVerificationDocumentTypes)[number];

export type DedupHashInput = {
	documentType: OrgVerificationDocumentType;
	documentNumber: string;
	issuingCountry: string;
};

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * SHA-256 hash of `pepper || document_type || "|" || normalized_number || "|"
 * || normalized_country`. The pepper is high-entropy and lives in Workers
 * Secrets, so we don't need a slow KDF — SHA-256 is the right primitive.
 *
 * Returns the hex digest. Pure function: same input + pepper always returns
 * the same digest, so it is trivially testable with golden vectors.
 */
export async function computeDedupHash(
	input: DedupHashInput,
	pepper: string | Uint8Array,
): Promise<string> {
	const documentType = input.documentType;
	const documentNumber = normalizeDocumentNumber(input.documentNumber);
	const issuingCountry = normalizeIssuingCountry(input.issuingCountry);

	if (documentNumber.length === 0) {
		throw new Error("document_number must contain at least one character.");
	}

	const pepperBytes =
		typeof pepper === "string" ? new TextEncoder().encode(pepper) : pepper;
	const payloadBytes = new TextEncoder().encode(
		[documentType, documentNumber, issuingCountry].join(FIELD_SEPARATOR),
	);

	const buffer = new Uint8Array(pepperBytes.length + payloadBytes.length);
	buffer.set(pepperBytes, 0);
	buffer.set(payloadBytes, pepperBytes.length);

	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return bytesToHex(new Uint8Array(digest));
}
