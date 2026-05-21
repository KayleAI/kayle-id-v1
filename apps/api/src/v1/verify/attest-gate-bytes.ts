const SHA_256_ALGORITHM = "SHA-256";

export function textBytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) {
		total += part.length;
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	const buffer = await crypto.subtle.digest(
		SHA_256_ALGORITHM,
		toAlignedArrayBuffer(bytes),
	);
	return new Uint8Array(buffer);
}

export function base64ToBytes(input: string): Uint8Array {
	const binary = atob(input);
	const out = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		out[index] = binary.charCodeAt(index);
	}
	return out;
}

function toAlignedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
