import { Certificate } from "pkijs";
import { base64ToBytes, toAlignedArrayBuffer } from "./app-attest-bytes";

const APPLE_NONCE_EXTENSION_OID = "1.2.840.113635.100.8.2";

export function extractAppleNonceExtension(
	cert: Certificate,
): Uint8Array | null {
	const extensions = cert.extensions ?? [];
	for (const ext of extensions) {
		if (ext.extnID !== APPLE_NONCE_EXTENSION_OID) continue;
		const inner = (
			ext as unknown as {
				extnValue: { valueBlock: { valueHexView: Uint8Array } };
			}
		).extnValue.valueBlock.valueHexView;
		return findInnerOctetString(new Uint8Array(inner), 32);
	}
	return null;
}

export function exportSubjectPublicKey(cert: Certificate): Uint8Array {
	const spki = cert.subjectPublicKeyInfo.subjectPublicKey;
	return new Uint8Array(spki.valueBlock.valueHexView);
}

export function parseRootCertFromPem(pem: string): Certificate {
	const stripped = pem
		.replace(/-----BEGIN CERTIFICATE-----/u, "")
		.replace(/-----END CERTIFICATE-----/u, "")
		.replace(/\s+/gu, "");
	const der = base64ToBytes(stripped);
	return Certificate.fromBER(toAlignedArrayBuffer(der));
}

function findInnerOctetString(
	bytes: Uint8Array,
	expectedLength: number,
): Uint8Array | null {
	for (let i = 0; i < bytes.length - 1; i += 1) {
		if (
			bytes[i] === 0x04 &&
			bytes[i + 1] === expectedLength &&
			i + 2 + expectedLength <= bytes.length
		) {
			return bytes.slice(i + 2, i + 2 + expectedLength);
		}
	}
	return null;
}
