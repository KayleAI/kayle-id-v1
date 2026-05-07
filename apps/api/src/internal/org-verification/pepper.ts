/**
 * Pepper management for organization verification dedup hashes.
 *
 * The pepper lives only in Workers Secrets (one per environment). Rotation is
 * a break-glass operation: rotating invalidates every existing dedup_hash, so
 * dedup against historical records becomes impossible against the new pepper.
 *
 * To make rotation feasible without throwing away the prior history, support
 * for additional active versions is wired in via `ORG_VERIFICATION_PEPPER_V<N>`
 * variables. New writes always use the current version (`pepperVersion = 1`
 * by default, bumped per rotation); lookups iterate every active version so a
 * candidate document can match a row written under any older still-supported
 * pepper.
 */

const CURRENT_PEPPER_VERSION_ENV = "ORG_VERIFICATION_PEPPER";
const VERSION_PREFIX = "ORG_VERIFICATION_PEPPER_V";

export type PepperBinding = Record<string, string | undefined>;

export type ActivePepper = {
	version: number;
	value: string;
};

/**
 * Returns the pepper used for new writes. Defaults to version 1 on the
 * legacy `ORG_VERIFICATION_PEPPER` key; if a numbered key
 * (`ORG_VERIFICATION_PEPPER_V2`, etc.) exists we pick the highest one.
 */
export function getCurrentPepper(env: PepperBinding): ActivePepper {
	const versions = listActivePeppers(env);
	const newest = versions.at(-1);
	if (!newest) {
		throw new Error(
			"ORG_VERIFICATION_PEPPER is not configured for this environment.",
		);
	}
	return newest;
}

/**
 * All active peppers, oldest-first. Used at lookup time so a candidate
 * document can be hashed against every still-trusted version.
 */
export function listActivePeppers(env: PepperBinding): ActivePepper[] {
	const peppers: ActivePepper[] = [];

	const baseValue = env[CURRENT_PEPPER_VERSION_ENV];
	if (baseValue && baseValue.length > 0) {
		peppers.push({ version: 1, value: baseValue });
	}

	for (const key of Object.keys(env)) {
		if (!key.startsWith(VERSION_PREFIX)) {
			continue;
		}
		const versionText = key.slice(VERSION_PREFIX.length);
		const version = Number.parseInt(versionText, 10);
		if (!Number.isInteger(version) || version <= 1) {
			continue;
		}
		const value = env[key];
		if (!value || value.length === 0) {
			continue;
		}
		peppers.push({ version, value });
	}

	peppers.sort((a, b) => a.version - b.version);
	return peppers;
}
