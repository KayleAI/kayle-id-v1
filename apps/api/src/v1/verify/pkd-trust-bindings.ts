import type { PkdTrustD1Database, PkdTrustR2Bucket } from "./pkd-trust-types";

export function getPkdTrustR2Bucket(env: unknown): PkdTrustR2Bucket | null {
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

export function getPkdTrustStoreDatabase(
	env: unknown,
): PkdTrustD1Database | null {
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
