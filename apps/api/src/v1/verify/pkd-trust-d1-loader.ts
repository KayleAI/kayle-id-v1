import { emitD1Read } from "./pkd-trust-analytics";
import {
	clearPkdTrustBundleCache,
	pkdTrustBundleCacheExpired,
	readPkdTrustBundleCache,
	writePkdTrustBundleCache,
} from "./pkd-trust-cache";
import { hydratePkdTrustBundle } from "./pkd-trust-hydrate";
import {
	SELECT_TRUST_STORE_CRL_REVOCATIONS_SQL,
	SELECT_TRUST_STORE_CRLS_SQL,
	SELECT_TRUST_STORE_CSCAS_SQL,
	SELECT_TRUST_STORE_DSC_BY_ISSUER_SERIAL_SQL,
	SELECT_TRUST_STORE_DSCS_BY_SKI_SQL,
	SELECT_TRUST_STORE_METADATA_SQL,
} from "./pkd-trust-queries";
import { mapTrustStoreCscaRow, mapTrustStoreDscRow } from "./pkd-trust-records";
import {
	type PKD_TRUST_BUNDLE_VERSION,
	type PkdCertificateRecord,
	type PkdTrustBundle,
	type PkdTrustBundleJson,
	type PkdTrustD1Database,
	TRUST_STORE_METADATA_ID,
	type TrustStoreCrlRevocationRow,
	type TrustStoreCrlRow,
	type TrustStoreCscaRow,
	type TrustStoreMetadataRow,
} from "./pkd-trust-types";
import { addIndexedValue } from "./pkd-trust-utils";

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

export async function loadTrustBundleFromD1Database(
	database: PkdTrustD1Database,
): Promise<PkdTrustBundle | null> {
	const cache = readPkdTrustBundleCache();
	if (cache.bundle && !pkdTrustBundleCacheExpired()) {
		return cache.bundle;
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

	writePkdTrustBundleCache({
		bundle: hydrated,
		etag: null,
	});

	return hydrated;
}
