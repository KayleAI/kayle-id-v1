export function utf8FixedLength(text: string, length: number): Uint8Array {
	const out = new Uint8Array(length);
	const encoded = new TextEncoder().encode(text);
	out.set(encoded.slice(0, length));
	return out;
}

export function readUint32BE(bytes: Uint8Array, offset: number): number {
	const b0 = bytes[offset] as number;
	const b1 = bytes[offset + 1] as number;
	const b2 = bytes[offset + 2] as number;
	const b3 = bytes[offset + 3] as number;
	return b0 * 0x1_00_00_00 + ((b1 << 16) | (b2 << 8) | b3);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) total += part.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

export function toAlignedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	const buffer = await crypto.subtle.digest(
		"SHA-256",
		toAlignedArrayBuffer(bytes),
	);
	return new Uint8Array(buffer);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function base64ToBytes(input: string): Uint8Array {
	const binary = atob(input);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}

export function base64UrlToBytes(input: string): Uint8Array {
	const padded = input.replace(/-/g, "+").replace(/_/g, "/");
	const padLength = (4 - (padded.length % 4)) % 4;
	return base64ToBytes(padded + "=".repeat(padLength));
}
