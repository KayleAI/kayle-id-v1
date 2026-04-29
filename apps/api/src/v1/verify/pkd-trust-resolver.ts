import type {
	PkdTrustBundle,
	PkdTrustBundleCertificate,
	PkdTrustBundleDscSegment,
} from "./pkd-trust-types";
import {
	addIndexedValue,
	decodeBase64,
	dscIssuerSerialKey,
	parseDerCertificate,
} from "./pkd-trust-utils";

async function loadPkdTrustBundleDscSegment(
	bundle: PkdTrustBundle,
	segmentKey: string,
): Promise<PkdTrustBundleDscSegment | null> {
	const normalizedSegmentKey = segmentKey.toUpperCase();
	const cached = bundle.dscSegments.get(normalizedSegmentKey);

	if (cached) {
		return cached;
	}

	if (!bundle.dscSegmentLoader) {
		return null;
	}

	const loaded = await bundle.dscSegmentLoader(normalizedSegmentKey);

	if (!loaded) {
		return null;
	}

	bundle.dscSegments.set(normalizedSegmentKey, loaded);
	return loaded;
}

function resolveInlinePkdDscCertificate(
	bundle: PkdTrustBundle,
	issuerKey: string,
	serialNumberHex: string,
): PkdTrustBundleCertificate | null {
	const key = dscIssuerSerialKey(issuerKey, serialNumberHex);
	const cached = bundle.dscsByIssuerSerial.get(key);

	if (cached) {
		return cached;
	}

	const record = bundle.dscRecordsByIssuerSerial.get(key);

	if (!record) {
		return null;
	}

	const entry = {
		cert: parseDerCertificate(decodeBase64(record.derBase64)),
		record,
	};
	bundle.dscsByIssuerSerial.set(key, entry);
	return entry;
}

function resolveInlinePkdDscCertificatesBySki(
	bundle: PkdTrustBundle,
	skiHex: string,
): PkdTrustBundleCertificate[] {
	const normalizedSkiHex = skiHex.toLowerCase();
	const cached = bundle.dscsBySkiHex.get(normalizedSkiHex);

	if (cached) {
		return [...cached];
	}

	const records = bundle.dscRecordsBySkiHex.get(normalizedSkiHex) ?? [];
	const entries = records.map((record) => ({
		cert: parseDerCertificate(decodeBase64(record.derBase64)),
		record,
	}));

	bundle.dscsBySkiHex.set(normalizedSkiHex, entries);
	return [...entries];
}

function resolveSegmentPkdDscCertificate(
	segment: PkdTrustBundleDscSegment,
	issuerKey: string,
	serialNumberHex: string,
): PkdTrustBundleCertificate | null {
	const key = dscIssuerSerialKey(issuerKey, serialNumberHex);
	const cached = segment.dscsByIssuerSerial.get(key);

	if (cached) {
		return cached;
	}

	const record = segment.dscRecordsByIssuerSerial.get(key);

	if (!record) {
		return null;
	}

	const entry = {
		cert: parseDerCertificate(decodeBase64(record.derBase64)),
		record,
	};
	segment.dscsByIssuerSerial.set(key, entry);
	return entry;
}

function resolveSegmentPkdDscCertificatesBySki(
	segment: PkdTrustBundleDscSegment,
	skiHex: string,
): PkdTrustBundleCertificate[] {
	const normalizedSkiHex = skiHex.toLowerCase();
	const cached = segment.dscsBySkiHex.get(normalizedSkiHex);

	if (cached) {
		return [...cached];
	}

	const records = segment.dscRecordsBySkiHex.get(normalizedSkiHex) ?? [];
	const entries = records.map((record) => ({
		cert: parseDerCertificate(decodeBase64(record.derBase64)),
		record,
	}));

	segment.dscsBySkiHex.set(normalizedSkiHex, entries);
	return [...entries];
}

export async function resolvePkdDscCertificate(
	bundle: PkdTrustBundle,
	issuerKey: string,
	serialNumberHex: string,
): Promise<PkdTrustBundleCertificate | null> {
	const inlineEntry = resolveInlinePkdDscCertificate(
		bundle,
		issuerKey,
		serialNumberHex,
	);

	if (inlineEntry) {
		return inlineEntry;
	}

	const key = dscIssuerSerialKey(issuerKey, serialNumberHex);
	const segmentKeys = bundle.dscSegmentKeysByIssuerSerial.get(key) ?? [];

	for (const segmentKey of segmentKeys) {
		const segment = await loadPkdTrustBundleDscSegment(bundle, segmentKey);

		if (!segment) {
			continue;
		}

		const entry = resolveSegmentPkdDscCertificate(
			segment,
			issuerKey,
			serialNumberHex,
		);

		if (entry) {
			return entry;
		}
	}

	if (bundle.dscRecordLoaderByIssuerSerial) {
		const record = await bundle.dscRecordLoaderByIssuerSerial(
			issuerKey,
			serialNumberHex,
		);

		if (record) {
			bundle.dscRecordsByIssuerSerial.set(
				dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
				record,
			);
			addIndexedValue(bundle.dscRecordsBySkiHex, record.skiHex, record);

			return resolveInlinePkdDscCertificate(
				bundle,
				record.issuerKey,
				record.serialNumberHex,
			);
		}
	}

	return null;
}

export async function resolvePkdDscCertificatesBySki(
	bundle: PkdTrustBundle,
	skiHex: string,
): Promise<PkdTrustBundleCertificate[]> {
	const deduped = new Map<string, PkdTrustBundleCertificate>();

	for (const entry of resolveInlinePkdDscCertificatesBySki(bundle, skiHex)) {
		deduped.set(entry.record.derBase64, entry);
	}

	const segmentKeys =
		bundle.dscSegmentKeysBySkiHex.get(skiHex.toLowerCase()) ?? [];

	for (const segmentKey of segmentKeys) {
		const segment = await loadPkdTrustBundleDscSegment(bundle, segmentKey);

		if (!segment) {
			continue;
		}

		for (const entry of resolveSegmentPkdDscCertificatesBySki(
			segment,
			skiHex,
		)) {
			deduped.set(entry.record.derBase64, entry);
		}
	}

	if (bundle.dscRecordsLoaderBySkiHex) {
		for (const record of await bundle.dscRecordsLoaderBySkiHex(skiHex)) {
			bundle.dscRecordsByIssuerSerial.set(
				dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
				record,
			);
			addIndexedValue(bundle.dscRecordsBySkiHex, record.skiHex, record);
		}

		for (const entry of resolveInlinePkdDscCertificatesBySki(bundle, skiHex)) {
			deduped.set(entry.record.derBase64, entry);
		}
	}

	return [...deduped.values()];
}
