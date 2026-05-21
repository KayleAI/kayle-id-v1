import {
	matchesAscii,
	readUint16BigEndian,
	readUint16LittleEndian,
	readUint24LittleEndian,
	readUint32BigEndian,
	readUint32LittleEndian,
} from "./logo-byte-readers";
import {
	type AllowedLogoMime,
	LogoValidationError,
	MAX_LOGO_DIMENSION,
} from "./logo-policy";

const MAX_LOGO_PIXELS = MAX_LOGO_DIMENSION * MAX_LOGO_DIMENSION;

type ImageDimensions = {
	height: number;
	width: number;
};

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (
		bytes.length < 24 ||
		readUint32BigEndian(bytes, 8) !== 13 ||
		!matchesAscii(bytes, 12, "IHDR")
	) {
		return null;
	}

	return {
		height: readUint32BigEndian(bytes, 20),
		width: readUint32BigEndian(bytes, 16),
	};
}

function readGifDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (bytes.length < 10) {
		return null;
	}

	return {
		height: readUint16LittleEndian(bytes, 8),
		width: readUint16LittleEndian(bytes, 6),
	};
}

function readLosslessWebpDimensions(
	bytes: Uint8Array,
	dataStart: number,
	chunkSize: number,
): ImageDimensions | null {
	if (chunkSize < 5 || bytes[dataStart] !== 0x2f) {
		return null;
	}

	const first = bytes[dataStart + 1];
	const second = bytes[dataStart + 2];
	const third = bytes[dataStart + 3];
	const fourth = bytes[dataStart + 4];

	return {
		height:
			1 + (((second & 0xc0) >> 6) | (third << 2) | ((fourth & 0x0f) << 10)),
		width: 1 + (first | ((second & 0x3f) << 8)),
	};
}

function readLossyWebpDimensions(
	bytes: Uint8Array,
	dataStart: number,
	chunkSize: number,
): ImageDimensions | null {
	if (
		chunkSize < 10 ||
		bytes[dataStart + 3] !== 0x9d ||
		bytes[dataStart + 4] !== 0x01 ||
		bytes[dataStart + 5] !== 0x2a
	) {
		return null;
	}

	return {
		height: readUint16LittleEndian(bytes, dataStart + 8) & 0x3fff,
		width: readUint16LittleEndian(bytes, dataStart + 6) & 0x3fff,
	};
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
	let offset = 12;

	while (offset + 8 <= bytes.length) {
		const chunkSize = readUint32LittleEndian(bytes, offset + 4);
		const dataStart = offset + 8;
		const dataEnd = dataStart + chunkSize;

		if (dataEnd > bytes.length) {
			return null;
		}

		if (matchesAscii(bytes, offset, "VP8X")) {
			if (chunkSize < 10) {
				return null;
			}

			return {
				height: 1 + readUint24LittleEndian(bytes, dataStart + 7),
				width: 1 + readUint24LittleEndian(bytes, dataStart + 4),
			};
		}

		if (matchesAscii(bytes, offset, "VP8L")) {
			return readLosslessWebpDimensions(bytes, dataStart, chunkSize);
		}

		if (matchesAscii(bytes, offset, "VP8 ")) {
			return readLossyWebpDimensions(bytes, dataStart, chunkSize);
		}

		offset = dataEnd + (chunkSize % 2);
	}

	return null;
}

function isJpegStartOfFrame(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
	let offset = 2;

	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) {
			return null;
		}

		while (bytes[offset] === 0xff) {
			offset += 1;
		}

		if (offset >= bytes.length) {
			return null;
		}

		const marker = bytes[offset];
		offset += 1;

		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
			continue;
		}

		if (offset + 2 > bytes.length) {
			return null;
		}

		const segmentLength = readUint16BigEndian(bytes, offset);
		const segmentEnd = offset + segmentLength;

		if (segmentLength < 2 || segmentEnd > bytes.length) {
			return null;
		}

		if (isJpegStartOfFrame(marker)) {
			if (segmentLength < 8) {
				return null;
			}

			return {
				height: readUint16BigEndian(bytes, offset + 3),
				width: readUint16BigEndian(bytes, offset + 5),
			};
		}

		if (marker === 0xda) {
			return null;
		}

		offset = segmentEnd;
	}

	return null;
}

function readImageDimensions(
	bytes: Uint8Array,
	mime: AllowedLogoMime,
): ImageDimensions | null {
	switch (mime) {
		case "image/png":
			return readPngDimensions(bytes);
		case "image/jpeg":
			return readJpegDimensions(bytes);
		case "image/gif":
			return readGifDimensions(bytes);
		case "image/webp":
			return readWebpDimensions(bytes);
	}
}

export function assertLogoDimensions(
	bytes: Uint8Array,
	mime: AllowedLogoMime,
): void {
	const dimensions = readImageDimensions(bytes, mime);

	if (!dimensions) {
		throw new LogoValidationError(
			"Organization logo dimensions could not be read.",
		);
	}

	if (
		dimensions.width < 1 ||
		dimensions.height < 1 ||
		dimensions.width > MAX_LOGO_DIMENSION ||
		dimensions.height > MAX_LOGO_DIMENSION ||
		dimensions.width * dimensions.height > MAX_LOGO_PIXELS
	) {
		throw new LogoValidationError(
			"Organization logo dimensions exceed the maximum size.",
		);
	}
}
