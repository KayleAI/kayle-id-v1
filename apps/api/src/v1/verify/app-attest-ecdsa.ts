export function derEcdsaToRaw(der: Uint8Array, coordBytes: number): Uint8Array {
	if (der.length < 8 || der[0] !== 0x30) {
		throw new Error("ecdsa_der_not_sequence");
	}
	let offset = 2;
	if ((der[1] as number) & 0x80) {
		const lenBytes = (der[1] as number) & 0x7f;
		offset = 2 + lenBytes;
	}

	if (der[offset] !== 0x02) throw new Error("ecdsa_der_r_not_integer");
	const rLen = der[offset + 1] as number;
	const rStart = offset + 2;
	const r = der.slice(rStart, rStart + rLen);

	const sOffset = rStart + rLen;
	if (der[sOffset] !== 0x02) throw new Error("ecdsa_der_s_not_integer");
	const sLen = der[sOffset + 1] as number;
	const sStart = sOffset + 2;
	const s = der.slice(sStart, sStart + sLen);

	const out = new Uint8Array(coordBytes * 2);
	out.set(leftPadOrTrim(r, coordBytes), 0);
	out.set(leftPadOrTrim(s, coordBytes), coordBytes);
	return out;
}

function leftPadOrTrim(bytes: Uint8Array, targetLength: number): Uint8Array {
	if (bytes.length === targetLength) return bytes;
	if (bytes.length === targetLength + 1 && bytes[0] === 0x00) {
		return bytes.slice(1);
	}
	if (bytes.length < targetLength) {
		const out = new Uint8Array(targetLength);
		out.set(bytes, targetLength - bytes.length);
		return out;
	}
	throw new Error("ecdsa_integer_too_long");
}
