import { afterEach, describe, expect, test } from "bun:test";
import {
	clearPkdTrustBundleCache,
	configurePkdTrustBundleLoader,
	configurePkdTrustBundleLoaderFromEnv,
	loadPkdTrustBundle,
	pkdTrustBundleDscSegmentKey,
	pkdTrustBundleKey,
	resolvePkdDscCertificate,
	resolvePkdDscCertificatesBySki,
} from "@/v1/verify/pkd-trust";
import { createPassiveAuthTestChain } from "../helpers/verify-artifacts";

afterEach(() => {
	Date.now = originalDateNow;
	configurePkdTrustBundleLoader(null);
	clearPkdTrustBundleCache();
});

const originalDateNow = Date.now;

function createMockTrustStoreDatabase(
	raw: Awaited<
		ReturnType<typeof createPassiveAuthTestChain>
	>["trustBundle"]["raw"],
	requestedQueries: string[],
) {
	const metadataRow = {
		cscaCount: raw.counts.cscas,
		crlCount: raw.counts.crls,
		dscCount: raw.counts.dscs,
		generatedAt: raw.generatedAt,
		ignoredBcsc: raw.counts.ignoredBcsc,
		ignoredBcscNc: raw.counts.ignoredBcscNc,
		masterListsLdifPath: raw.sources.masterListsLdif.path,
		masterListsLdifVersion: raw.sources.masterListsLdif.version,
		objectLdifPath: raw.sources.objectLdif.path,
		objectLdifVersion: raw.sources.objectLdif.version,
		version: raw.version,
	};
	const cscaRows = raw.cscas.map((record) => ({
		...record,
		masterListSourcesJson: JSON.stringify(record.masterListSources),
	}));
	const crlRows = raw.crls.map((record, index) => ({
		akiHex: record.akiHex,
		derBase64: record.derBase64,
		id: index + 1,
		issuerKey: record.issuerKey,
		issuerName: record.issuerName,
		nextUpdate: record.nextUpdate,
		sourceCountryCode: record.sourceCountryCode,
		sourceDn: record.sourceDn,
		thisUpdate: record.thisUpdate,
	}));
	const crlRevocationRows = raw.crls.flatMap((record, index) =>
		record.revokedSerialNumbersHex.map((revokedSerialNumberHex) => ({
			crlId: index + 1,
			revokedSerialNumberHex,
		})),
	);

	return {
		prepare(query: string) {
			const normalizedQuery = query.replace(/\s+/g, " ").trim();

			return {
				bind(...values: unknown[]) {
					requestedQueries.push(
						`${normalizedQuery} :: ${JSON.stringify(values)}`,
					);

					return {
						all: async () => {
							if (normalizedQuery.includes("FROM trust_store_cscas")) {
								return { results: cscaRows };
							}

							if (normalizedQuery.includes("FROM trust_store_crls")) {
								return { results: crlRows };
							}

							if (
								normalizedQuery.includes("FROM trust_store_crl_revocations")
							) {
								return { results: crlRevocationRows };
							}

							if (
								normalizedQuery.includes("FROM trust_store_dscs") &&
								normalizedQuery.includes("WHERE ski_hex = ?")
							) {
								const [skiHex] = values;
								return {
									results: raw.dscs.filter(
										(record) =>
											record.skiHex?.toLowerCase() ===
											String(skiHex).toLowerCase(),
									),
								};
							}

							return { results: [] };
						},
						first: async () => {
							if (normalizedQuery.includes("FROM trust_store_metadata")) {
								return metadataRow;
							}

							if (
								normalizedQuery.includes("FROM trust_store_dscs") &&
								normalizedQuery.includes(
									"WHERE issuer_key = ? AND serial_number_hex = ?",
								)
							) {
								const [issuerKey, serialNumberHex] = values;

								return (
									raw.dscs.find(
										(record) =>
											record.issuerKey === issuerKey &&
											record.serialNumberHex.toLowerCase() ===
												String(serialNumberHex).toLowerCase(),
									) ?? null
								);
							}

							return null;
						},
					};
				},
			};
		},
	};
}

describe("PKD trust bundle loader", () => {
	test.serial(
		"verify-artifacts does not configure a trust bundle loader unless one is set explicitly",
		async () => {
			const chain = await createPassiveAuthTestChain();

			expect(chain.trustBundle.raw.counts.dscs).toBe(1);
			expect(await loadPkdTrustBundle()).toBeNull();
		},
	);

	test.serial("loads the trust bundle from R2 when available", async () => {
		const chain = await createPassiveAuthTestChain();
		const responseBytes = new TextEncoder().encode(
			JSON.stringify(chain.trustBundle.raw),
		);
		let requestedKey = "";

		configurePkdTrustBundleLoaderFromEnv({
			STORAGE: {
				get: (key: string) => {
					requestedKey = key;

					return Promise.resolve({
						arrayBuffer: () => Promise.resolve(responseBytes.slice().buffer),
						httpEtag: "test-r2-etag",
					});
				},
			},
		});

		const loaded = await loadPkdTrustBundle();

		expect(requestedKey).toBe(pkdTrustBundleKey());
		expect(loaded?.raw.counts).toEqual(chain.trustBundle.raw.counts);
		expect(loaded?.raw.generatedAt).toBe(chain.trustBundle.raw.generatedAt);
	});

	test.serial("loads the trust bundle from D1 when available", async () => {
		const chain = await createPassiveAuthTestChain();
		const requestedQueries: string[] = [];
		let requestedR2Key = "";

		configurePkdTrustBundleLoaderFromEnv({
			STORAGE: {
				get: (key: string) => {
					requestedR2Key = key;
					return Promise.resolve(null);
				},
			},
			TRUST_STORE: createMockTrustStoreDatabase(
				chain.trustBundle.raw,
				requestedQueries,
			),
		});

		const loaded = await loadPkdTrustBundle();

		expect(requestedR2Key).toBe("");
		expect(loaded?.raw.counts).toEqual(chain.trustBundle.raw.counts);
		expect(
			requestedQueries.some((query) => query.includes("trust_store_metadata")),
		).toBe(true);
	});

	test.serial(
		"loads DSC records lazily from D1 when bundle fallback needs them",
		async () => {
			const chain = await createPassiveAuthTestChain();
			const [dscRecord] = chain.trustBundle.raw.dscs;
			const requestedQueries: string[] = [];

			configurePkdTrustBundleLoaderFromEnv({
				TRUST_STORE: createMockTrustStoreDatabase(
					chain.trustBundle.raw,
					requestedQueries,
				),
			});

			const loaded = await loadPkdTrustBundle();

			expect(loaded).not.toBeNull();
			if (!loaded) {
				throw new Error("Expected trust bundle to load");
			}
			expect(
				requestedQueries.some((query) =>
					query.includes("FROM trust_store_dscs"),
				),
			).toBe(false);

			const resolvedByIssuerSerial = await resolvePkdDscCertificate(
				loaded,
				dscRecord?.issuerKey ?? "",
				dscRecord?.serialNumberHex ?? "",
			);
			const resolvedBySki = await resolvePkdDscCertificatesBySki(
				loaded,
				dscRecord?.skiHex ?? "",
			);

			expect(resolvedByIssuerSerial?.record.derBase64).toBe(
				dscRecord?.derBase64,
			);
			expect(resolvedBySki.map((entry) => entry.record.derBase64)).toEqual([
				dscRecord?.derBase64,
			]);
			expect(
				requestedQueries.some((query) =>
					query.includes("WHERE issuer_key = ? AND serial_number_hex = ?"),
				),
			).toBe(true);
			expect(
				requestedQueries.some((query) => query.includes("WHERE ski_hex = ?")),
			).toBe(true);
		},
	);

	test.serial(
		"loads DSC segments lazily from R2 when bundle fallback needs them",
		async () => {
			const chain = await createPassiveAuthTestChain();
			const [dscRecord] = chain.trustBundle.raw.dscs;

			expect(dscRecord?.skiHex).not.toBeNull();

			const manifestBytes = new TextEncoder().encode(
				JSON.stringify({
					...chain.trustBundle.raw,
					dscSegmentIndex: {
						issuerSerial: {
							[`${dscRecord?.issuerKey}:${dscRecord?.serialNumberHex.toLowerCase()}`]:
								["UT"],
						},
						skiHex: {
							[dscRecord?.skiHex ?? ""]: ["UT"],
						},
					},
					dscs: [],
				}),
			);
			const segmentBytes = new TextEncoder().encode(
				JSON.stringify({
					dscs: chain.trustBundle.raw.dscs,
					segmentKey: "UT",
					version: chain.trustBundle.raw.version,
				}),
			);
			const requestedKeys: string[] = [];

			configurePkdTrustBundleLoaderFromEnv({
				STORAGE: {
					get: (key: string) => {
						requestedKeys.push(key);

						if (key === pkdTrustBundleKey()) {
							return Promise.resolve({
								arrayBuffer: () =>
									Promise.resolve(manifestBytes.slice().buffer),
								httpEtag: "manifest-etag",
							});
						}

						if (key === pkdTrustBundleDscSegmentKey("UT")) {
							return Promise.resolve({
								arrayBuffer: () => Promise.resolve(segmentBytes.slice().buffer),
								httpEtag: "segment-etag",
							});
						}

						return Promise.resolve(null);
					},
				},
			});

			const loaded = await loadPkdTrustBundle();

			expect(loaded).not.toBeNull();
			if (!loaded) {
				throw new Error("Expected trust bundle to load");
			}
			expect(requestedKeys).toEqual([pkdTrustBundleKey()]);

			const resolvedByIssuerSerial = await resolvePkdDscCertificate(
				loaded,
				dscRecord?.issuerKey ?? "",
				dscRecord?.serialNumberHex ?? "",
			);
			const resolvedBySki = await resolvePkdDscCertificatesBySki(
				loaded,
				dscRecord?.skiHex ?? "",
			);

			expect(resolvedByIssuerSerial?.record.derBase64).toBe(
				dscRecord?.derBase64,
			);
			expect(resolvedBySki.map((entry) => entry.record.derBase64)).toEqual([
				dscRecord?.derBase64,
			]);
			expect(requestedKeys).toEqual([
				pkdTrustBundleKey(),
				pkdTrustBundleDscSegmentKey("UT"),
			]);
		},
	);

	test.serial(
		"loads the trust bundle from inline env JSON before consulting R2",
		async () => {
			const chain = await createPassiveAuthTestChain();
			let requestedKey = "";

			configurePkdTrustBundleLoaderFromEnv({
				STORAGE: {
					get: (key: string) => {
						requestedKey = key;
						return Promise.resolve(null);
					},
				},
				VERIFY_PKD_TRUST_BUNDLE_JSON: JSON.stringify(chain.trustBundle.raw),
			});

			const loaded = await loadPkdTrustBundle();

			expect(requestedKey).toBe("");
			expect(loaded?.raw.counts).toEqual(chain.trustBundle.raw.counts);
			expect(loaded?.raw.generatedAt).toBe(chain.trustBundle.raw.generatedAt);
		},
	);

	test.serial(
		"fails closed when the R2 trust bundle disappears after cache expiry",
		async () => {
			const chain = await createPassiveAuthTestChain();
			const responseBytes = new TextEncoder().encode(
				JSON.stringify(chain.trustBundle.raw),
			);
			let now = 1000;
			let getCalls = 0;

			Date.now = () => now;

			configurePkdTrustBundleLoaderFromEnv({
				STORAGE: {
					get: () => {
						getCalls += 1;

						if (getCalls === 1) {
							return Promise.resolve({
								arrayBuffer: () =>
									Promise.resolve(responseBytes.slice().buffer),
								httpEtag: "test-r2-etag",
							});
						}

						return Promise.resolve(null);
					},
				},
			});

			const firstLoad = await loadPkdTrustBundle();
			now += 5 * 60 * 1000 + 1;
			const secondLoad = await loadPkdTrustBundle();

			expect(firstLoad?.raw.counts).toEqual(chain.trustBundle.raw.counts);
			expect(secondLoad).toBeNull();
			expect(getCalls).toBe(2);
		},
	);
});
