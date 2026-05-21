import type { Certificate, CertificateRevocationList } from "pkijs";
import type {
	PkdCertificateRecord,
	PkdCrlRecord,
	PkdCscaRecord,
	PkdTrustBundleSource,
	TrustStoreCscaRow,
} from "./pkd-trust-types";
import {
	authorityKeyIdentifierHex,
	encodeBase64,
	formatRelativeDistinguishedName,
	hexBytes,
	relativeDistinguishedNameKey,
	subjectKeyIdentifierHex,
} from "./pkd-trust-utils";

export function parseMasterListSourcesJson(
	value: string,
): PkdTrustBundleSource[] {
	const parsed = JSON.parse(value) as unknown;

	return Array.isArray(parsed)
		? parsed.filter((entry): entry is PkdTrustBundleSource =>
				Boolean(
					entry &&
						typeof entry === "object" &&
						typeof Reflect.get(entry, "dn") === "string" &&
						(Reflect.get(entry, "countryCode") === null ||
							typeof Reflect.get(entry, "countryCode") === "string"),
				),
			)
		: [];
}

export function mapTrustStoreCscaRow(row: TrustStoreCscaRow): PkdCscaRecord {
	return {
		akiHex: row.akiHex,
		derBase64: row.derBase64,
		issuerKey: row.issuerKey,
		issuerName: row.issuerName,
		masterListSources: parseMasterListSourcesJson(row.masterListSourcesJson),
		notAfter: row.notAfter,
		notBefore: row.notBefore,
		serialNumberHex: row.serialNumberHex,
		skiHex: row.skiHex,
		sourceCountryCode: row.sourceCountryCode,
		sourceDn: row.sourceDn,
		subjectKey: row.subjectKey,
		subjectName: row.subjectName,
	};
}

export function mapTrustStoreDscRow(
	row: PkdCertificateRecord,
): PkdCertificateRecord {
	return {
		akiHex: row.akiHex,
		derBase64: row.derBase64,
		issuerKey: row.issuerKey,
		issuerName: row.issuerName,
		notAfter: row.notAfter,
		notBefore: row.notBefore,
		serialNumberHex: row.serialNumberHex,
		skiHex: row.skiHex,
		sourceCountryCode: row.sourceCountryCode,
		sourceDn: row.sourceDn,
		subjectKey: row.subjectKey,
		subjectName: row.subjectName,
	};
}

export async function createPkdCertificateRecord({
	cert,
	derBytes,
	masterListSources,
	sourceCountryCode,
	sourceDn,
}: {
	cert: Certificate;
	derBytes: Uint8Array;
	masterListSources?: PkdTrustBundleSource[];
	sourceCountryCode: string | null;
	sourceDn: string;
}): Promise<PkdCertificateRecord | PkdCscaRecord> {
	const baseRecord = {
		akiHex: authorityKeyIdentifierHex(cert),
		derBase64: encodeBase64(derBytes),
		issuerKey: relativeDistinguishedNameKey(cert.issuer),
		issuerName: formatRelativeDistinguishedName(cert.issuer),
		notAfter: cert.notAfter.value.toISOString(),
		notBefore: cert.notBefore.value.toISOString(),
		serialNumberHex: hexBytes(
			new Uint8Array(cert.serialNumber.valueBlock.valueHex),
		),
		skiHex: await subjectKeyIdentifierHex(cert),
		sourceCountryCode,
		sourceDn,
		subjectKey: relativeDistinguishedNameKey(cert.subject),
		subjectName: formatRelativeDistinguishedName(cert.subject),
	} satisfies PkdCertificateRecord;

	return masterListSources
		? {
				...baseRecord,
				masterListSources,
			}
		: baseRecord;
}

export function createPkdCrlRecord({
	crl,
	derBytes,
	sourceCountryCode,
	sourceDn,
}: {
	crl: CertificateRevocationList;
	derBytes: Uint8Array;
	sourceCountryCode: string | null;
	sourceDn: string;
}): PkdCrlRecord {
	return {
		akiHex: authorityKeyIdentifierHex({
			extensions: crl.crlExtensions,
		}),
		derBase64: encodeBase64(derBytes),
		issuerKey: relativeDistinguishedNameKey(crl.issuer),
		issuerName: formatRelativeDistinguishedName(crl.issuer),
		nextUpdate: crl.nextUpdate?.value.toISOString() ?? null,
		revokedSerialNumbersHex:
			crl.revokedCertificates?.map((entry) =>
				hexBytes(new Uint8Array(entry.userCertificate.valueBlock.valueHex)),
			) ?? [],
		sourceCountryCode,
		sourceDn,
		thisUpdate: crl.thisUpdate.value.toISOString(),
	};
}
