import { emitR2ClassB } from "./pkd-trust-analytics";
import {
	clearPkdTrustBundleCache,
	pkdTrustBundleCacheExpired,
	readPkdTrustBundleCache,
	refreshPkdTrustBundleCacheExpiration,
	writePkdTrustBundleCache,
} from "./pkd-trust-cache";
import {
	hydratePkdTrustBundle,
	hydratePkdTrustBundleDscSegment,
} from "./pkd-trust-hydrate";
import {
	PKD_TRUST_R2_DSC_SEGMENT_KEY_PREFIX,
	PKD_TRUST_R2_KEY,
	type PkdTrustBundle,
	type PkdTrustR2Bucket,
} from "./pkd-trust-types";

function parseTextJson(bytes: Uint8Array): unknown {
	return JSON.parse(new TextDecoder().decode(bytes));
}

export async function loadTrustBundleFromR2Bucket(
	bucket: PkdTrustR2Bucket,
): Promise<PkdTrustBundle | null> {
	const cache = readPkdTrustBundleCache();
	if (cache.bundle && !pkdTrustBundleCacheExpired()) {
		return cache.bundle;
	}

	const object = await bucket.get(PKD_TRUST_R2_KEY);
	emitR2ClassB();

	if (!object) {
		clearPkdTrustBundleCache();
		return null;
	}

	const currentCache = readPkdTrustBundleCache();
	if (
		currentCache.bundle &&
		currentCache.etag &&
		object.httpEtag === currentCache.etag
	) {
		refreshPkdTrustBundleCacheExpiration();
		return currentCache.bundle;
	}

	const bytes = new Uint8Array(await object.arrayBuffer());
	const parsed = parseTextJson(bytes);
	const hydrated = hydratePkdTrustBundle(parsed, {
		dscSegmentLoader: (segmentKey) =>
			loadTrustBundleDscSegmentFromR2Bucket(bucket, segmentKey),
	});

	writePkdTrustBundleCache({
		bundle: hydrated,
		etag: object.httpEtag,
	});

	return hydrated;
}

export async function loadTrustBundleDscSegmentFromR2Bucket(
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

export function pkdTrustBundleKey(): string {
	return PKD_TRUST_R2_KEY;
}

export function pkdTrustBundleDscSegmentKey(segmentKey: string): string {
	return `${PKD_TRUST_R2_DSC_SEGMENT_KEY_PREFIX}/${segmentKey.toUpperCase()}.json`;
}
