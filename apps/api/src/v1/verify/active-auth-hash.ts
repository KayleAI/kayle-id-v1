import { bufferBytes } from "./sod-asn1-utils";

export const HASH_LENGTHS = {
	"SHA-1": 20,
	"SHA-224": 28,
	"SHA-256": 32,
	"SHA-384": 48,
	"SHA-512": 64,
} as const;

export type AaHashAlgorithm = keyof typeof HASH_LENGTHS;

export function digestBytes(
	algorithm: AaHashAlgorithm,
	data: Uint8Array,
): Promise<Uint8Array> {
	return crypto.subtle
		.digest(algorithm, bufferBytes(data))
		.then((buffer) => new Uint8Array(buffer));
}
