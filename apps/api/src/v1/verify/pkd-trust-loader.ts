import {
	clearPkdTrustAnalyticsDataset,
	configurePkdTrustAnalyticsDataset,
} from "./pkd-trust-analytics";
import {
	getPkdTrustR2Bucket,
	getPkdTrustStoreDatabase,
} from "./pkd-trust-bindings";
import { clearPkdTrustBundleCache } from "./pkd-trust-cache";
import { loadTrustBundleFromD1Database } from "./pkd-trust-d1-loader";
import { hydratePkdTrustBundle } from "./pkd-trust-hydrate";
import { loadTrustBundleFromR2Bucket } from "./pkd-trust-r2-loader";
import {
	INLINE_PKD_TRUST_BUNDLE_ENV_KEY,
	PKD_TRUST_BUNDLE_VERSION,
	type PkdTrustBundle,
	type PkdTrustBundleLoader,
	type PkdTrustD1Database,
	type PkdTrustR2Bucket,
} from "./pkd-trust-types";
import { resolveStringEnvValue } from "./pkd-trust-utils";

export { clearPkdTrustBundleCache } from "./pkd-trust-cache";
export {
	pkdTrustBundleDscSegmentKey,
	pkdTrustBundleKey,
} from "./pkd-trust-r2-loader";
export {
	createPkdCertificateRecord,
	createPkdCrlRecord,
} from "./pkd-trust-records";

let trustBundleLoader: PkdTrustBundleLoader | null = null;
let configuredTrustStoreDatabase: PkdTrustD1Database | null = null;
let configuredR2Bucket: PkdTrustR2Bucket | null = null;
let configuredInlineTrustBundleJson: string | null = null;

export function configurePkdTrustBundleLoader(
	loader: PkdTrustBundleLoader | null,
): void {
	configuredTrustStoreDatabase = null;
	configuredR2Bucket = null;
	configuredInlineTrustBundleJson = null;
	clearPkdTrustAnalyticsDataset();
	trustBundleLoader = loader;
	clearPkdTrustBundleCache();
}

export function configurePkdTrustBundleLoaderFromEnv(env: unknown): void {
	configurePkdTrustAnalyticsDataset(env);
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

	const trustStoreDatabase = getPkdTrustStoreDatabase(env);

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

	const bucket = getPkdTrustR2Bucket(env);

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

export function pkdTrustBundleVersion(): typeof PKD_TRUST_BUNDLE_VERSION {
	return PKD_TRUST_BUNDLE_VERSION;
}
