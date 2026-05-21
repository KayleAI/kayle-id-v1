import type { ChipAuthAlgorithm } from "./chip-auth-oids";
import type {
	ChipAuthInfoEntry,
	ChipAuthPublicKeyInfoEntry,
} from "./dg14-parser";

export function selectChipAuthInfo(
	infos: ChipAuthInfoEntry[],
	oid: string,
	keyId: bigint | null,
): ChipAuthInfoEntry | null {
	const matches = infos.filter((info) => info.algorithm.oid === oid);

	if (matches.length === 0) {
		return null;
	}

	if (keyId !== null) {
		return matches.find((info) => info.keyId === keyId) ?? null;
	}

	if (matches.length === 1) {
		return matches[0] ?? null;
	}

	return matches.find((info) => info.keyId === null) ?? null;
}

export function selectChipAuthPublicKey(
	keys: ChipAuthPublicKeyInfoEntry[],
	algorithm: ChipAuthAlgorithm,
	keyId: bigint | null,
): ChipAuthPublicKeyInfoEntry | null {
	const compatible = keys.filter(
		(entry) => entry.algorithmOid === algorithm.publicKeyOid,
	);

	if (compatible.length === 0) {
		return null;
	}

	if (keyId !== null) {
		return compatible.find((entry) => entry.keyId === keyId) ?? null;
	}

	if (compatible.length === 1) {
		return compatible[0] ?? null;
	}

	return compatible.find((entry) => entry.keyId === null) ?? null;
}
