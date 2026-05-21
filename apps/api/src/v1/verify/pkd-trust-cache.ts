import {
	PKD_TRUST_BUNDLE_CACHE_TTL_MS,
	type PkdTrustBundle,
	type PkdTrustBundleCache,
} from "./pkd-trust-types";

let trustBundleCache: PkdTrustBundleCache = {
	bundle: null,
	etag: null,
	expiresAt: 0,
};

export function readPkdTrustBundleCache(): Readonly<PkdTrustBundleCache> {
	return trustBundleCache;
}

export function pkdTrustBundleCacheExpired(): boolean {
	return trustBundleCache.expiresAt <= Date.now();
}

export function refreshPkdTrustBundleCacheExpiration(): void {
	trustBundleCache = {
		...trustBundleCache,
		expiresAt: Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS,
	};
}

export function writePkdTrustBundleCache({
	bundle,
	etag,
}: {
	bundle: PkdTrustBundle;
	etag: string | null;
}): void {
	trustBundleCache = {
		bundle,
		etag,
		expiresAt: Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS,
	};
}

export function clearPkdTrustBundleCache(): void {
	trustBundleCache = {
		bundle: null,
		etag: null,
		expiresAt: 0,
	};
}
