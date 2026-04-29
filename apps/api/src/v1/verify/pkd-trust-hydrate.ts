import {
	PKD_TRUST_BUNDLE_VERSION,
	type PkdCertificateRecord,
	type PkdTrustBundle,
	type PkdTrustBundleCertificate,
	type PkdTrustBundleCrl,
	type PkdTrustBundleDscRecordByIssuerSerialLoader,
	type PkdTrustBundleDscRecordsBySkiLoader,
	type PkdTrustBundleDscSegment,
	type PkdTrustBundleDscSegmentJson,
	type PkdTrustBundleDscSegmentLoader,
	type PkdTrustBundleJson,
} from "./pkd-trust-types";
import {
	addIndexedValue,
	decodeBase64,
	dscIssuerSerialKey,
	parseDerCertificate,
	parseDerCertificateRevocationList,
} from "./pkd-trust-utils";

function objectMapToStringArrayIndex(
	value: Record<string, string[]> | null | undefined,
): Map<string, string[]> {
	const index = new Map<string, string[]>();

	if (!value) {
		return index;
	}

	for (const [key, entries] of Object.entries(value)) {
		if (!(key && Array.isArray(entries))) {
			continue;
		}

		index.set(
			key.toLowerCase(),
			Array.from(new Set(entries.filter((entry) => typeof entry === "string"))),
		);
	}

	return index;
}

export function parsePkdTrustBundleJson(value: unknown): PkdTrustBundleJson {
	if (!value || typeof value !== "object") {
		throw new Error("pkd_trust_bundle_invalid");
	}

	const bundle = value as PkdTrustBundleJson;

	if (bundle.version !== PKD_TRUST_BUNDLE_VERSION) {
		throw new Error("pkd_trust_bundle_version_invalid");
	}

	if (
		!(
			Array.isArray(bundle.cscas) &&
			Array.isArray(bundle.crls) &&
			Array.isArray(bundle.dscs)
		)
	) {
		throw new Error("pkd_trust_bundle_invalid");
	}

	return bundle;
}

export function parsePkdTrustBundleDscSegmentJson(
	value: unknown,
): PkdTrustBundleDscSegmentJson {
	if (!value || typeof value !== "object") {
		throw new Error("pkd_trust_bundle_dsc_segment_invalid");
	}

	const segment = value as PkdTrustBundleDscSegmentJson;

	if (
		segment.version !== PKD_TRUST_BUNDLE_VERSION ||
		!Array.isArray(segment.dscs) ||
		typeof segment.segmentKey !== "string" ||
		segment.segmentKey.length === 0
	) {
		throw new Error("pkd_trust_bundle_dsc_segment_invalid");
	}

	return segment;
}

export function hydratePkdTrustBundleDscSegment(
	value: unknown,
): PkdTrustBundleDscSegment {
	const raw = parsePkdTrustBundleDscSegmentJson(value);
	const dscRecordsByIssuerSerial = new Map<string, PkdCertificateRecord>();
	const dscRecordsBySkiHex = new Map<string, PkdCertificateRecord[]>();

	for (const record of raw.dscs) {
		dscRecordsByIssuerSerial.set(
			dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
			record,
		);
		addIndexedValue(dscRecordsBySkiHex, record.skiHex, record);
	}

	return {
		dscRecordsByIssuerSerial,
		dscRecordsBySkiHex,
		dscsByIssuerSerial: new Map<string, PkdTrustBundleCertificate>(),
		dscsBySkiHex: new Map<string, PkdTrustBundleCertificate[]>(),
		raw,
	};
}

export function hydratePkdTrustBundle(
	value: unknown,
	options?: {
		dscRecordLoaderByIssuerSerial?: PkdTrustBundleDscRecordByIssuerSerialLoader | null;
		dscRecordsLoaderBySkiHex?: PkdTrustBundleDscRecordsBySkiLoader | null;
		dscSegmentLoader?: PkdTrustBundleDscSegmentLoader | null;
	},
): PkdTrustBundle {
	const raw = parsePkdTrustBundleJson(value);
	const cscas: PkdTrustBundleCertificate[] = [];
	const crls: PkdTrustBundleCrl[] = [];
	const cscasBySubjectKey = new Map<string, PkdTrustBundleCertificate[]>();
	const cscasBySkiHex = new Map<string, PkdTrustBundleCertificate[]>();
	const crlsByAkiHex = new Map<string, PkdTrustBundleCrl[]>();
	const crlsByIssuerKey = new Map<string, PkdTrustBundleCrl[]>();
	const dscRecordsByIssuerSerial = new Map<string, PkdCertificateRecord>();
	const dscRecordsBySkiHex = new Map<string, PkdCertificateRecord[]>();
	const dscSegmentKeysByIssuerSerial = objectMapToStringArrayIndex(
		raw.dscSegmentIndex?.issuerSerial,
	);
	const dscSegmentKeysBySkiHex = objectMapToStringArrayIndex(
		raw.dscSegmentIndex?.skiHex,
	);

	for (const record of raw.cscas) {
		const cert = parseDerCertificate(decodeBase64(record.derBase64));
		const entry = { cert, record };
		cscas.push(entry);
		addIndexedValue(cscasBySubjectKey, record.subjectKey, entry);
		addIndexedValue(cscasBySkiHex, record.skiHex, entry);
	}

	for (const record of raw.crls) {
		const crl = parseDerCertificateRevocationList(
			decodeBase64(record.derBase64),
		);
		const entry = { crl, record };
		crls.push(entry);
		addIndexedValue(crlsByIssuerKey, record.issuerKey, entry);
		addIndexedValue(crlsByAkiHex, record.akiHex, entry);
	}

	for (const record of raw.dscs) {
		dscRecordsByIssuerSerial.set(
			dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
			record,
		);
		addIndexedValue(dscRecordsBySkiHex, record.skiHex, record);
	}

	return {
		cscas,
		cscasBySubjectKey,
		cscasBySkiHex,
		crls,
		crlsByAkiHex,
		crlsByIssuerKey,
		dscRecordsByIssuerSerial,
		dscRecordsBySkiHex,
		dscSegmentKeysByIssuerSerial,
		dscSegmentKeysBySkiHex,
		dscSegments: new Map<string, PkdTrustBundleDscSegment>(),
		dscRecordLoaderByIssuerSerial:
			options?.dscRecordLoaderByIssuerSerial ?? null,
		dscRecordsLoaderBySkiHex: options?.dscRecordsLoaderBySkiHex ?? null,
		dscSegmentLoader: options?.dscSegmentLoader ?? null,
		dscsByIssuerSerial: new Map<string, PkdTrustBundleCertificate>(),
		dscsBySkiHex: new Map<string, PkdTrustBundleCertificate[]>(),
		raw,
	};
}
