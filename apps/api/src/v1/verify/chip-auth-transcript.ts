/**
 * Wire layout for the iOS-uploaded Chip Authentication transcript carried in
 * the CHIP_AUTH data frame. Mirrors the TR-03110-2 §3.4 (CA-v2) protocol
 * surface that the server needs to recompute T_PICC.
 *
 * Layout (all multi-byte integers big-endian):
 *   uint8    version            // currently 0x01
 *   uint16   oidLen
 *   bytes    oid                // ASCII / dotted CA OID
 *   uint8    keyIdLen           // 0 = absent
 *   bytes    keyId              // unsigned big-endian
 *   uint16   skLen
 *   bytes    sk_pcd             // terminal ephemeral private key
 *   uint16   pkLen
 *   bytes    pk_pcd             // terminal ephemeral public key
 *   uint8    nonceLen
 *   bytes    r_picc             // chip nonce
 *   uint8    tokenLen
 *   bytes    t_picc             // chip MAC token
 */

const TRANSCRIPT_VERSION = 0x01;

export type ChipAuthTranscript = {
	chipNonce: Uint8Array;
	chipToken: Uint8Array;
	keyId: bigint | null;
	oid: string;
	terminalPrivateKey: Uint8Array;
	terminalPublicKey: Uint8Array;
};

class TranscriptReader {
	private offset = 0;
	constructor(private readonly data: Uint8Array) {}

	private remaining(): number {
		return this.data.length - this.offset;
	}

	uint8(): number {
		if (this.remaining() < 1) {
			throw new Error("chip_auth_transcript_truncated");
		}
		const value = this.data[this.offset] ?? 0;
		this.offset += 1;
		return value;
	}

	uint16(): number {
		if (this.remaining() < 2) {
			throw new Error("chip_auth_transcript_truncated");
		}
		const value =
			((this.data[this.offset] ?? 0) << 8) | (this.data[this.offset + 1] ?? 0);
		this.offset += 2;
		return value;
	}

	bytes(length: number): Uint8Array {
		if (length < 0 || this.remaining() < length) {
			throw new Error("chip_auth_transcript_truncated");
		}
		const value = this.data.slice(this.offset, this.offset + length);
		this.offset += length;
		return value;
	}

	consumed(): boolean {
		return this.offset === this.data.length;
	}
}

function bytesToBigInt(bytes: Uint8Array): bigint {
	if (bytes.length === 0) {
		return 0n;
	}
	let result = 0n;
	for (const byte of bytes) {
		result = (result << 8n) | BigInt(byte);
	}
	return result;
}

export function parseChipAuthTranscript(data: Uint8Array): ChipAuthTranscript {
	const reader = new TranscriptReader(data);
	const version = reader.uint8();

	if (version !== TRANSCRIPT_VERSION) {
		throw new Error("chip_auth_transcript_version_unsupported");
	}

	const oidLen = reader.uint16();
	const oidBytes = reader.bytes(oidLen);
	const oid = new TextDecoder("utf-8", {
		fatal: true,
		ignoreBOM: false,
	}).decode(oidBytes);

	const keyIdLen = reader.uint8();
	const keyIdBytes = reader.bytes(keyIdLen);
	const keyId = keyIdLen === 0 ? null : bytesToBigInt(keyIdBytes);

	const skLen = reader.uint16();
	const terminalPrivateKey = reader.bytes(skLen);

	const pkLen = reader.uint16();
	const terminalPublicKey = reader.bytes(pkLen);

	const nonceLen = reader.uint8();
	const chipNonce = reader.bytes(nonceLen);

	const tokenLen = reader.uint8();
	const chipToken = reader.bytes(tokenLen);

	if (!reader.consumed()) {
		throw new Error("chip_auth_transcript_trailing_bytes");
	}

	if (
		oid.length === 0 ||
		terminalPrivateKey.length === 0 ||
		terminalPublicKey.length === 0 ||
		chipNonce.length === 0 ||
		chipToken.length === 0
	) {
		throw new Error("chip_auth_transcript_field_missing");
	}

	return {
		chipNonce,
		chipToken,
		keyId,
		oid,
		terminalPrivateKey,
		terminalPublicKey,
	};
}
