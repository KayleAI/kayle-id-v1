export function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readUint16LittleEndian(
	bytes: Uint8Array,
	offset: number,
): number {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readUint24LittleEndian(
	bytes: Uint8Array,
	offset: number,
): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

export function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] * 0x1000000 +
		((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
	);
}

export function readUint32LittleEndian(
	bytes: Uint8Array,
	offset: number,
): number {
	return (
		bytes[offset] |
		(bytes[offset + 1] << 8) |
		(bytes[offset + 2] << 16) |
		(bytes[offset + 3] * 0x1000000)
	);
}

export function matchesAscii(
	bytes: Uint8Array,
	offset: number,
	value: string,
): boolean {
	if (offset + value.length > bytes.length) {
		return false;
	}

	for (let index = 0; index < value.length; index += 1) {
		if (bytes[offset + index] !== value.charCodeAt(index)) {
			return false;
		}
	}

	return true;
}
