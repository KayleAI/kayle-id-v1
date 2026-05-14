import {
	type AnalyticsEngineDatasetLike,
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import type { Certificate, CertificateRevocationList } from "pkijs";
import {
	hydratePkdTrustBundle,
	hydratePkdTrustBundleDscSegment,
} from "./pkd-trust-hydrate";
import {
	SELECT_TRUST_STORE_CRL_REVOCATIONS_SQL,
	SELECT_TRUST_STORE_CRLS_SQL,
	SELECT_TRUST_STORE_CSCAS_SQL,
	SELECT_TRUST_STORE_DSC_BY_ISSUER_SERIAL_SQL,
	SELECT_TRUST_STORE_DSCS_BY_SKI_SQL,
	SELECT_TRUST_STORE_METADATA_SQL,
} from "./pkd-trust-queries";
import {
	INLINE_PKD_TRUST_BUNDLE_ENV_KEY,
	PKD_TRUST_BUNDLE_CACHE_TTL_MS,
	PKD_TRUST_BUNDLE_VERSION,
	PKD_TRUST_R2_DSC_SEGMENT_KEY_PREFIX,
	PKD_TRUST_R2_KEY,
	type PkdCertificateRecord,
	type PkdCrlRecord,
	type PkdCscaRecord,
	type PkdTrustBundle,
	type PkdTrustBundleCache,
	type PkdTrustBundleJson,
	type PkdTrustBundleLoader,
	type PkdTrustBundleSource,
	type PkdTrustD1Database,
	type PkdTrustR2Bucket,
	TRUST_STORE_METADATA_ID,
	type TrustStoreCrlRevocationRow,
	type TrustStoreCrlRow,
	type TrustStoreCscaRow,
	type TrustStoreMetadataRow,
} from "./pkd-trust-types";
import {
	addIndexedValue,
	authorityKeyIdentifierHex,
	encodeBase64,
	formatRelativeDistinguishedName,
	hexBytes,
	relativeDistinguishedNameKey,
	resolveStringEnvValue,
	subjectKeyIdentifierHex,
} from "./pkd-trust-utils";

let trustBundleLoader: PkdTrustBundleLoader | null = null;
let configuredTrustStoreDatabase: PkdTrustD1Database | null = null;
let configuredR2Bucket: PkdTrustR2Bucket | null = null;
let configuredInlineTrustBundleJson: string | null = null;
let configuredAnalyticsDataset: AnalyticsEngineDatasetLike | null = null;
let trustBundleCache: PkdTrustBundleCache = {
	bundle: null,
	etag: null,
	expiresAt: 0,
};

const TRUST_LOADER_WORKER_NAME = "kayle-id-api";

function getR2Bucket(env: unknown): PkdTrustR2Bucket | null {
	if (!env || typeof env !== "object") {
		return null;
	}

	const candidate = Reflect.get(env, "STORAGE");

	return candidate &&
		typeof candidate === "object" &&
		typeof Reflect.get(candidate, "get") === "function"
		? (candidate as PkdTrustR2Bucket)
		: null;
}

function getTrustStoreDatabase(env: unknown): PkdTrustD1Database | null {
	if (!env || typeof env !== "object") {
		return null;
	}

	const candidate = Reflect.get(env, "TRUST_STORE");

	return candidate &&
		typeof candidate === "object" &&
		typeof Reflect.get(candidate, "prepare") === "function"
		? (candidate as PkdTrustD1Database)
		: null;
}

function parseTextJson(bytes: Uint8Array): unknown {
	return JSON.parse(new TextDecoder().decode(bytes));
}

function pkdTrustBundleCacheExpired(): boolean {
	return trustBundleCache.expiresAt <= Date.now();
}

async function loadTrustBundleFromR2Bucket(
	bucket: PkdTrustR2Bucket,
): Promise<PkdTrustBundle | null> {
	if (trustBundleCache.bundle && !pkdTrustBundleCacheExpired()) {
		return trustBundleCache.bundle;
	}

	const object = await bucket.get(PKD_TRUST_R2_KEY);
	emitR2ClassB();

	if (!object) {
		clearPkdTrustBundleCache();
		return null;
	}

	if (
		trustBundleCache.bundle &&
		trustBundleCache.etag &&
		object.httpEtag === trustBundleCache.etag
	) {
		trustBundleCache.expiresAt = Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS;
		return trustBundleCache.bundle;
	}

	const bytes = new Uint8Array(await object.arrayBuffer());
	const parsed = parseTextJson(bytes);
	const hydrated = hydratePkdTrustBundle(parsed, {
		dscSegmentLoader: (segmentKey) =>
			loadTrustBundleDscSegmentFromR2Bucket(bucket, segmentKey),
	});

	trustBundleCache = {
		bundle: hydrated,
		etag: object.httpEtag,
		expiresAt: Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS,
	};

	return hydrated;
}

async function loadTrustBundleDscSegmentFromR2Bucket(
	bucket: PkdTrustR2Bucket,
	segmentKey: string,
) {
	const object = await bucket.get(pkdTrustBundleDscSegmentKey(segmentKey));
	emitR2ClassB();

	if (!object) {
		return null;
	}

	const bytes = new Uint8Array(await object.arrayBuffer());
	return hydratePkdTrustBundleDscSegment(parseTextJson(bytes));
}

function emitD1Read(rowCount: number): void {
	if (!configuredAnalyticsDataset || rowCount <= 0) {
		return;
	}
	emitCostEvent({
		dataset: configuredAnalyticsDataset,
		feature: COST_FEATURES.Verify,
		resource: "d1_read",
		quantity: rowCount,
		unit: "row",
		workerName: TRUST_LOADER_WORKER_NAME,
	});
}

function emitR2ClassB(): void {
	if (!configuredAnalyticsDataset) {
		return;
	}
	emitCostEvent({
		dataset: configuredAnalyticsDataset,
		feature: COST_FEATURES.Verify,
		resource: "r2_class_b",
		quantity: 1,
		unit: "operation",
		workerName: TRUST_LOADER_WORKER_NAME,
	});
}

async function queryFirstRow<T>(
	database: PkdTrustD1Database,
	query: string,
	...values: unknown[]
): Promise<T | null> {
	const row = await database
		.prepare(query)
		.bind(...values)
		.first<T>();
	emitD1Read(row === null ? 0 : 1);
	return row;
}

async function queryRows<T>(
	database: PkdTrustD1Database,
	query: string,
	...values: unknown[]
): Promise<T[]> {
	const result = await database
		.prepare(query)
		.bind(...values)
		.all<T>();
	const rows = result.results ?? [];
	emitD1Read(rows.length);
	return rows;
}

function parseMasterListSourcesJson(value: string): PkdTrustBundleSource[] {
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

function mapTrustStoreCscaRow(row: TrustStoreCscaRow): PkdCscaRecord {
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

function mapTrustStoreDscRow(row: PkdCertificateRecord): PkdCertificateRecord {
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

async function loadTrustBundleFromD1Database(
	database: PkdTrustD1Database,
): Promise<PkdTrustBundle | null> {
	if (trustBundleCache.bundle && !pkdTrustBundleCacheExpired()) {
		return trustBundleCache.bundle;
	}

	const metadata = await queryFirstRow<TrustStoreMetadataRow>(
		database,
		SELECT_TRUST_STORE_METADATA_SQL,
		TRUST_STORE_METADATA_ID,
	);

	if (!metadata) {
		clearPkdTrustBundleCache();
		return null;
	}

	const [cscaRows, crlRows, crlRevocationRows] = await Promise.all([
		queryRows<TrustStoreCscaRow>(database, SELECT_TRUST_STORE_CSCAS_SQL),
		queryRows<TrustStoreCrlRow>(database, SELECT_TRUST_STORE_CRLS_SQL),
		queryRows<TrustStoreCrlRevocationRow>(
			database,
			SELECT_TRUST_STORE_CRL_REVOCATIONS_SQL,
		),
	]);
	const revokedSerialsByCrlId = new Map<string, string[]>();

	for (const row of crlRevocationRows) {
		addIndexedValue(
			revokedSerialsByCrlId,
			String(row.crlId),
			row.revokedSerialNumberHex,
		);
	}

	const raw: PkdTrustBundleJson = {
		counts: {
			cscas: metadata.cscaCount,
			crls: metadata.crlCount,
			dscs: metadata.dscCount,
			ignoredBcsc: metadata.ignoredBcsc,
			ignoredBcscNc: metadata.ignoredBcscNc,
		},
		cscas: cscaRows.map(mapTrustStoreCscaRow),
		crls: crlRows.map((row) => ({
			akiHex: row.akiHex,
			derBase64: row.derBase64,
			issuerKey: row.issuerKey,
			issuerName: row.issuerName,
			nextUpdate: row.nextUpdate,
			revokedSerialNumbersHex:
				revokedSerialsByCrlId.get(String(row.id))?.map((value) => value) ?? [],
			sourceCountryCode: row.sourceCountryCode,
			sourceDn: row.sourceDn,
			thisUpdate: row.thisUpdate,
		})),
		dscs: [],
		generatedAt: metadata.generatedAt,
		sources: {
			masterListsLdif: {
				path: metadata.masterListsLdifPath,
				version: metadata.masterListsLdifVersion,
			},
			objectLdif: {
				path: metadata.objectLdifPath,
				version: metadata.objectLdifVersion,
			},
		},
		version: metadata.version as typeof PKD_TRUST_BUNDLE_VERSION,
	};
	const hydrated = hydratePkdTrustBundle(raw, {
		dscRecordLoaderByIssuerSerial: async (issuerKey, serialNumberHex) => {
			const row = await queryFirstRow<PkdCertificateRecord>(
				database,
				SELECT_TRUST_STORE_DSC_BY_ISSUER_SERIAL_SQL,
				issuerKey,
				serialNumberHex.toLowerCase(),
			);

			return row ? mapTrustStoreDscRow(row) : null;
		},
		dscRecordsLoaderBySkiHex: async (skiHex) =>
			(
				await queryRows<PkdCertificateRecord>(
					database,
					SELECT_TRUST_STORE_DSCS_BY_SKI_SQL,
					skiHex.toLowerCase(),
				)
			).map(mapTrustStoreDscRow),
	});

	trustBundleCache = {
		bundle: hydrated,
		etag: null,
		expiresAt: Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS,
	};

	return hydrated;
}

export function clearPkdTrustBundleCache(): void {
	trustBundleCache = {
		bundle: null,
		etag: null,
		expiresAt: 0,
	};
}

export function configurePkdTrustBundleLoader(
	loader: PkdTrustBundleLoader | null,
): void {
	configuredTrustStoreDatabase = null;
	configuredR2Bucket = null;
	configuredInlineTrustBundleJson = null;
	configuredAnalyticsDataset = null;
	trustBundleLoader = loader;
	clearPkdTrustBundleCache();
}

export function configurePkdTrustBundleLoaderFromEnv(env: unknown): void {
	// Analytics binding (optional): bundle hits issue 1× metadata
	// SELECT + 3× bulk SELECTs on cache miss. Emit per-row d1_read
	// cost events so the dashboard sees trust-store work even though
	// org_id isn't known at this layer (rows get `_unattributed`).
	configuredAnalyticsDataset = resolveAnalyticsDataset(env);
	const inlineTrustBundleJson = resolveStringEnvValue(
		env,
		INLINE_PKD_TRUST_BUNDLE_ENV_KEY,
	);

	if (inlineTrustBundleJson) {
		if (
			configuredInlineTrustBundleJson === inlineTrustBundleJson &&
			trustBundleLoader
		) {
			return;
		}

		configuredR2Bucket = null;
		configuredTrustStoreDatabase = null;
		configuredInlineTrustBundleJson = inlineTrustBundleJson;
		trustBundleLoader = async () =>
			hydratePkdTrustBundle(JSON.parse(inlineTrustBundleJson));
		clearPkdTrustBundleCache();
		return;
	}

	const trustStoreDatabase = getTrustStoreDatabase(env);

	if (trustStoreDatabase) {
		if (
			configuredTrustStoreDatabase === trustStoreDatabase &&
			trustBundleLoader
		) {
			return;
		}

		configuredTrustStoreDatabase = trustStoreDatabase;
		configuredR2Bucket = null;
		configuredInlineTrustBundleJson = null;
		trustBundleLoader = () => loadTrustBundleFromD1Database(trustStoreDatabase);
		clearPkdTrustBundleCache();
		return;
	}

	const bucket = getR2Bucket(env);

	if (!bucket) {
		if (
			!(
				configuredTrustStoreDatabase ||
				configuredR2Bucket ||
				configuredInlineTrustBundleJson ||
				trustBundleLoader
			)
		) {
			return;
		}

		configurePkdTrustBundleLoader(null);
		return;
	}

	if (configuredR2Bucket === bucket && trustBundleLoader) {
		return;
	}

	configuredTrustStoreDatabase = null;
	configuredR2Bucket = bucket;
	configuredInlineTrustBundleJson = null;
	trustBundleLoader = () => loadTrustBundleFromR2Bucket(bucket);
	clearPkdTrustBundleCache();
}

export function loadPkdTrustBundle(): Promise<PkdTrustBundle | null> {
	return trustBundleLoader ? trustBundleLoader() : Promise.resolve(null);
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

export function pkdTrustBundleKey(): string {
	return PKD_TRUST_R2_KEY;
}

export function pkdTrustBundleDscSegmentKey(segmentKey: string): string {
	return `${PKD_TRUST_R2_DSC_SEGMENT_KEY_PREFIX}/${segmentKey.toUpperCase()}.json`;
}

export function pkdTrustBundleVersion(): typeof PKD_TRUST_BUNDLE_VERSION {
	return PKD_TRUST_BUNDLE_VERSION;
}
