import { OctetString } from "asn1js";
import { Certificate, IssuerAndSerialNumber, type SignedData } from "pkijs";
import {
	hexBytes,
	type PkdTrustBundle,
	relativeDistinguishedNameKey,
	resolvePkdDscCertificate,
	resolvePkdDscCertificatesBySki,
	subjectKeyIdentifierHex,
} from "./pkd-trust";
import { exactBytes, octetStringBytes } from "./sod-asn1-utils";
import type { PassiveAuthSignerSource } from "./validation-types";

export type ResolvedSignerCertificate = {
	cert: Certificate;
	signerSource: PassiveAuthSignerSource;
};

function issuerAndSerialFromSignerInfo(
	signerInfo: SignedData["signerInfos"][number],
): {
	issuerKey: string;
	serialNumberHex: string;
} | null {
	if (!(signerInfo.sid instanceof IssuerAndSerialNumber)) {
		return null;
	}

	return {
		issuerKey: relativeDistinguishedNameKey(signerInfo.sid.issuer),
		serialNumberHex: hexBytes(
			new Uint8Array(signerInfo.sid.serialNumber.valueBlock.valueHex),
		),
	};
}

function subjectKeyIdentifierFromSignerInfo(
	signerInfo: SignedData["signerInfos"][number],
): string | null {
	if (signerInfo.sid instanceof OctetString) {
		return hexBytes(octetStringBytes(signerInfo.sid));
	}

	const contextSpecificSid = signerInfo.sid as {
		idBlock?: {
			tagClass?: number;
			tagNumber?: number;
		};
		valueBlock?: {
			value?: unknown[];
			valueHex?: ArrayBuffer;
			valueHexView?: Uint8Array;
		};
	};

	if (
		contextSpecificSid.idBlock?.tagClass !== 3 ||
		contextSpecificSid.idBlock?.tagNumber !== 0
	) {
		return null;
	}

	const [nestedValue] = contextSpecificSid.valueBlock?.value ?? [];

	if (nestedValue instanceof OctetString) {
		return hexBytes(octetStringBytes(nestedValue));
	}

	if (contextSpecificSid.valueBlock?.valueHexView) {
		return hexBytes(exactBytes(contextSpecificSid.valueBlock.valueHexView));
	}

	if (contextSpecificSid.valueBlock?.valueHex) {
		return hexBytes(new Uint8Array(contextSpecificSid.valueBlock.valueHex));
	}

	return null;
}

function embeddedCertificates(signedData: SignedData): Certificate[] {
	return (
		signedData.certificates?.filter(
			(entry): entry is Certificate => entry instanceof Certificate,
		) ?? []
	);
}

async function certificateMatchesSigner(
	cert: Certificate,
	signerInfo: SignedData["signerInfos"][number],
): Promise<boolean> {
	if (signerInfo.sid instanceof IssuerAndSerialNumber) {
		const signerIdentifier = issuerAndSerialFromSignerInfo(signerInfo);

		return (
			signerIdentifier !== null &&
			relativeDistinguishedNameKey(cert.issuer) ===
				signerIdentifier.issuerKey &&
			hexBytes(new Uint8Array(cert.serialNumber.valueBlock.valueHex)) ===
				signerIdentifier.serialNumberHex
		);
	}

	const signerSkiHex = subjectKeyIdentifierFromSignerInfo(signerInfo);

	if (!signerSkiHex) {
		return false;
	}

	const certSkiHex = await subjectKeyIdentifierHex(cert);

	return certSkiHex === signerSkiHex;
}

function certificateIssuerSerialKey(cert: Certificate): string {
	return `${relativeDistinguishedNameKey(cert.issuer)}:${hexBytes(
		new Uint8Array(cert.serialNumber.valueBlock.valueHex),
	)}`;
}

function dedupeResolvedSignerCertificates(
	candidates: ResolvedSignerCertificate[],
): ResolvedSignerCertificate[] {
	const deduped = new Map<string, ResolvedSignerCertificate>();

	for (const candidate of candidates) {
		const key = `${candidate.signerSource}:${certificateIssuerSerialKey(
			candidate.cert,
		)}`;

		if (!deduped.has(key)) {
			deduped.set(key, candidate);
		}
	}

	return [...deduped.values()];
}

export async function resolveSignerCertificates({
	bundle,
	signedData,
	signerInfo,
}: {
	bundle: PkdTrustBundle | null;
	signedData: SignedData;
	signerInfo: SignedData["signerInfos"][number];
}): Promise<ResolvedSignerCertificate[]> {
	const candidates: ResolvedSignerCertificate[] = [];

	for (const cert of embeddedCertificates(signedData)) {
		if (await certificateMatchesSigner(cert, signerInfo)) {
			candidates.push({
				cert,
				signerSource: "sod",
			});
		}
	}

	if (!bundle) {
		return candidates;
	}

	const signerIdentifier = issuerAndSerialFromSignerInfo(signerInfo);
	const subjectKeyIdentifier = subjectKeyIdentifierFromSignerInfo(signerInfo);

	if (signerIdentifier) {
		const dsc = await resolvePkdDscCertificate(
			bundle,
			signerIdentifier.issuerKey,
			signerIdentifier.serialNumberHex,
		);

		if (dsc) {
			candidates.push({
				cert: dsc.cert,
				signerSource: "bundle",
			});
		}
	}

	if (subjectKeyIdentifier) {
		for (const dsc of await resolvePkdDscCertificatesBySki(
			bundle,
			subjectKeyIdentifier,
		)) {
			candidates.push({
				cert: dsc.cert,
				signerSource: "bundle",
			});
		}
	}

	return dedupeResolvedSignerCertificates(candidates);
}
