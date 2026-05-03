/**
 * AES-CMAC per NIST SP 800-38B. Implemented on top of WebCrypto AES-CBC because
 * SubtleCrypto exposes no raw ECB primitive — a single-block CBC encrypt with
 * a zero IV gives us the ECB output for that block (we discard the trailing
 * PKCS#7 padding block that AES-CBC adds).
 *
 * Used for the CA-v2 chip authentication token T_PICC verification per
 * TR-03110-2 §3.4 and for AES-CBC-CMAC secure-messaging key derivation.
 */

import { bufferBytes } from "./sod-asn1-utils";

const AES_BLOCK_BYTES = 16;
const RB = 0x87;

const ZERO_IV = new Uint8Array(AES_BLOCK_BYTES);

async function importAesCbcKey(rawKey: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		bufferBytes(rawKey),
		{ name: "AES-CBC", length: rawKey.length * 8 },
		false,
		["encrypt"],
	);
}

async function aesEncryptBlock(
	key: CryptoKey,
	block: Uint8Array,
): Promise<Uint8Array> {
	if (block.length !== AES_BLOCK_BYTES) {
		throw new Error("aes_block_size_invalid");
	}

	const ciphertext = await crypto.subtle.encrypt(
		{ iv: bufferBytes(ZERO_IV), name: "AES-CBC" },
		key,
		bufferBytes(block),
	);

	return new Uint8Array(ciphertext).slice(0, AES_BLOCK_BYTES);
}

function leftShiftOneBit(input: Uint8Array): Uint8Array {
	const output = new Uint8Array(input.length);
	let carry = 0;

	for (let index = input.length - 1; index >= 0; index -= 1) {
		const value = input[index] ?? 0;
		output[index] = ((value << 1) & 0xff) | carry;
		carry = (value & 0x80) >>> 7;
	}

	return output;
}

function xorBlocks(left: Uint8Array, right: Uint8Array): Uint8Array {
	const output = new Uint8Array(AES_BLOCK_BYTES);
	for (let index = 0; index < AES_BLOCK_BYTES; index += 1) {
		output[index] = (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return output;
}

async function deriveSubkeys(
	key: CryptoKey,
): Promise<{ k1: Uint8Array; k2: Uint8Array }> {
	const l = await aesEncryptBlock(key, new Uint8Array(AES_BLOCK_BYTES));

	const k1 = leftShiftOneBit(l);
	if ((l[0] ?? 0) & 0x80) {
		k1[AES_BLOCK_BYTES - 1] = (k1[AES_BLOCK_BYTES - 1] ?? 0) ^ RB;
	}

	const k2 = leftShiftOneBit(k1);
	if ((k1[0] ?? 0) & 0x80) {
		k2[AES_BLOCK_BYTES - 1] = (k2[AES_BLOCK_BYTES - 1] ?? 0) ^ RB;
	}

	return { k1, k2 };
}

function partitionMessage(message: Uint8Array): {
	fullBlocks: Uint8Array[];
	lastBlock: Uint8Array;
	lastIsComplete: boolean;
} {
	if (message.length === 0) {
		// CMAC of an empty message: pad a single zero block.
		const padded = new Uint8Array(AES_BLOCK_BYTES);
		padded[0] = 0x80;
		return { fullBlocks: [], lastBlock: padded, lastIsComplete: false };
	}

	const blockCount = Math.ceil(message.length / AES_BLOCK_BYTES);
	const lastBlockOffset = (blockCount - 1) * AES_BLOCK_BYTES;
	const lastBlockLength = message.length - lastBlockOffset;
	const lastIsComplete = lastBlockLength === AES_BLOCK_BYTES;

	const fullBlocks: Uint8Array[] = [];
	for (let index = 0; index < blockCount - 1; index += 1) {
		const start = index * AES_BLOCK_BYTES;
		fullBlocks.push(message.slice(start, start + AES_BLOCK_BYTES));
	}

	let lastBlock: Uint8Array;
	if (lastIsComplete) {
		lastBlock = message.slice(
			lastBlockOffset,
			lastBlockOffset + AES_BLOCK_BYTES,
		);
	} else {
		lastBlock = new Uint8Array(AES_BLOCK_BYTES);
		lastBlock.set(message.slice(lastBlockOffset), 0);
		lastBlock[lastBlockLength] = 0x80;
	}

	return { fullBlocks, lastBlock, lastIsComplete };
}

export async function aesCmac({
	key,
	message,
}: {
	key: Uint8Array;
	message: Uint8Array;
}): Promise<Uint8Array> {
	if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
		throw new Error("aes_cmac_key_length_invalid");
	}

	const cryptoKey = await importAesCbcKey(key);
	const { k1, k2 } = await deriveSubkeys(cryptoKey);
	const { fullBlocks, lastBlock, lastIsComplete } = partitionMessage(message);
	const maskedLast = xorBlocks(lastBlock, lastIsComplete ? k1 : k2);

	let chain: Uint8Array = new Uint8Array(AES_BLOCK_BYTES);
	for (const block of fullBlocks) {
		chain = await aesEncryptBlock(cryptoKey, xorBlocks(chain, block));
	}

	return aesEncryptBlock(cryptoKey, xorBlocks(chain, maskedLast));
}

export const AES_CMAC_TRUNCATED_TOKEN_BYTES = 8;

export function truncateMacToken(mac: Uint8Array): Uint8Array {
	return mac.slice(0, AES_CMAC_TRUNCATED_TOKEN_BYTES);
}
