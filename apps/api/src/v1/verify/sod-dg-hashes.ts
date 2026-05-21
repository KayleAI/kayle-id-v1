import { createDigest } from "./cms-signature";
import { bytesEqual } from "./sod-asn1-utils";
import type { ParsedSodSecurityObject } from "./sod-parser";

type OptionalDgCheckResult =
	| { ok: true }
	| {
			ok: false;
			reason:
				| "dg_hash_mismatch"
				| "sod_declared_dg_missing"
				| "sod_undeclared_dg_supplied";
	  };

async function verifyDeclaredDgHash({
	algorithm,
	bytes,
	expectedHash,
}: {
	algorithm: ParsedSodSecurityObject["algorithm"];
	bytes: Uint8Array | undefined;
	expectedHash: Uint8Array;
}): Promise<OptionalDgCheckResult> {
	if (!bytes || bytes.length === 0) {
		return { ok: false, reason: "sod_declared_dg_missing" };
	}

	const actualHash = await createDigest(algorithm, bytes);

	if (!bytesEqual(actualHash, expectedHash)) {
		return { ok: false, reason: "dg_hash_mismatch" };
	}

	return { ok: true };
}

function assertUndeclaredDgAbsent({
	bytes,
}: {
	bytes: Uint8Array | undefined;
}): OptionalDgCheckResult {
	if (bytes && bytes.length > 0) {
		return { ok: false, reason: "sod_undeclared_dg_supplied" };
	}

	return { ok: true };
}

export async function checkOptionalDg({
	algorithm,
	bytes,
	dataGroupNumber,
	dgHashes,
}: {
	algorithm: ParsedSodSecurityObject["algorithm"];
	bytes: Uint8Array | undefined;
	dataGroupNumber: number;
	dgHashes: Map<number, Uint8Array>;
}): Promise<OptionalDgCheckResult> {
	const expectedHash = dgHashes.get(dataGroupNumber);

	if (expectedHash) {
		return verifyDeclaredDgHash({ algorithm, bytes, expectedHash });
	}

	return assertUndeclaredDgAbsent({ bytes });
}
