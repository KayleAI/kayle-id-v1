import type { Certificate, SignerInfo } from "pkijs";

function encodeCmsDiagnosticValue(
	value: string | number | boolean | null,
): string {
	if (value === null) {
		return "null";
	}

	return String(value).replaceAll("|", "/");
}

export function cmsDiagnosticString(
	fields: Record<string, string | number | boolean | null>,
): string {
	return Object.entries(fields)
		.map(([key, value]) => `${key}=${encodeCmsDiagnosticValue(value)}`)
		.join("|");
}

export function signerInfoDiagnostics(
	signerInfo: SignerInfo,
	signerCert: Certificate,
): Record<string, string | number | boolean | null> {
	return {
		digest_algorithm: signerInfo.digestAlgorithm.algorithmId,
		public_key_algorithm: signerCert.subjectPublicKeyInfo.algorithm.algorithmId,
		signature_algorithm: signerInfo.signatureAlgorithm.algorithmId,
		signed_attrs: Boolean(signerInfo.signedAttrs),
		signed_attrs_length:
			signerInfo.signedAttrs?.encodedValue.byteLength ?? null,
	};
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

export function pkijsVerificationDetail(
	signerInfo: SignerInfo,
	signerCert: Certificate,
	result: {
		code?: number;
		message?: string;
		signatureVerified?: boolean | null;
	},
): string {
	return cmsDiagnosticString({
		path: "pkijs",
		...signerInfoDiagnostics(signerInfo, signerCert),
		pkijs_code: result.code ?? null,
		pkijs_message: result.message ?? null,
		pkijs_signature_verified: result.signatureVerified ?? null,
	});
}

export function manualVerificationDetail(
	signerInfo: SignerInfo,
	signerCert: Certificate,
	outcome: {
		error?: unknown;
		verified?: boolean;
	},
): string {
	return cmsDiagnosticString({
		path: "manual",
		...signerInfoDiagnostics(signerInfo, signerCert),
		manual_error: outcome.error ? errorMessage(outcome.error) : null,
		manual_verified: outcome.verified ?? null,
	});
}

export function issuerVerificationDetail({
	manual,
	pkijs,
	serialNumberHex,
}: {
	manual: string | null;
	pkijs: string | null;
	serialNumberHex: string;
}): string {
	return cmsDiagnosticString({
		issuer_manual: manual,
		issuer_pkijs: pkijs,
		issuer_serial: serialNumberHex,
	});
}
