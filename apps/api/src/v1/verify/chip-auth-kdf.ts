import type { ChipAuthKdfHash } from "./chip-auth-oids";
import { bufferBytes, concatUint8Arrays } from "./sod-asn1-utils";

const KDF_COUNTER_BYTES = 4;
const KDF_COUNTER_KENC = 1;
const KDF_COUNTER_KMAC = 2;

function counterBytes(value: number): Uint8Array {
	const bytes = new Uint8Array(KDF_COUNTER_BYTES);
	bytes[0] = (value >>> 24) & 0xff;
	bytes[1] = (value >>> 16) & 0xff;
	bytes[2] = (value >>> 8) & 0xff;
	bytes[3] = value & 0xff;
	return bytes;
}

async function digest(
	hash: ChipAuthKdfHash,
	data: Uint8Array,
): Promise<Uint8Array> {
	const buffer = await crypto.subtle.digest(hash, bufferBytes(data));
	return new Uint8Array(buffer);
}

/**
 * TR-03110-3 §A.2.3 KDF: H(K || r || c) where c is a 4-byte big-endian
 * counter (1 = K_Enc, 2 = K_MAC). The hash is SHA-1 for algorithms with
 * 16-byte session keys and SHA-256 for 24/32-byte keys; output is the
 * leading `keyLength` bytes of the digest.
 */
async function kdf({
	hash,
	keyLength,
	nonce,
	counter,
	sharedSecret,
}: {
	hash: ChipAuthKdfHash;
	keyLength: number;
	nonce: Uint8Array;
	counter: number;
	sharedSecret: Uint8Array;
}): Promise<Uint8Array> {
	const input = concatUint8Arrays([sharedSecret, nonce, counterBytes(counter)]);
	const result = await digest(hash, input);
	return result.slice(0, keyLength);
}

export function deriveChipAuthKEnc(args: {
	hash: ChipAuthKdfHash;
	keyLength: number;
	nonce: Uint8Array;
	sharedSecret: Uint8Array;
}): Promise<Uint8Array> {
	return kdf({ ...args, counter: KDF_COUNTER_KENC });
}

export function deriveChipAuthKMac(args: {
	hash: ChipAuthKdfHash;
	keyLength: number;
	nonce: Uint8Array;
	sharedSecret: Uint8Array;
}): Promise<Uint8Array> {
	return kdf({ ...args, counter: KDF_COUNTER_KMAC });
}
