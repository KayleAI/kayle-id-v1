import {
	createOrganizationLogoUrl,
	ORGANIZATION_LOGO_KEY_PREFIX,
} from "@kayle-id/auth/organization-logo";

type OrganizationLogoInput = {
	contentType: string;
	data: string;
};

type OrganizationLogoStorage = {
	put: (
		key: string,
		value: Uint8Array,
		options: {
			httpMetadata: {
				contentType: string;
			};
		},
	) => Promise<{ key: string }>;
};

export const ALLOWED_LOGO_MIME = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;
export type AllowedLogoMime = (typeof ALLOWED_LOGO_MIME)[number];

export const MAX_LOGO_BYTES = 1 * 1024 * 1024;
export const MAX_LOGO_DIMENSION = 2048;
const MAX_LOGO_PIXELS = MAX_LOGO_DIMENSION * MAX_LOGO_DIMENSION;

type ImageDimensions = {
	height: number;
	width: number;
};

/**
 * Thrown by `uploadOrganizationLogo` when the caller-supplied logo fails
 * server-side validation (bad base64, oversize, unrecognized format,
 * content-type mismatch). The route handler catches this specifically and
 * returns 400 — distinct from a true server fault, which stays as 500.
 */
export class LogoValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LogoValidationError";
	}
}

function decodeBase64LogoData(data: string): Uint8Array {
	let binary: string;

	try {
		binary = atob(data);
	} catch {
		throw new LogoValidationError(
			"Organization logo data must be base64 encoded.",
		);
	}

	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

/**
 * Identifies an image MIME from the leading magic bytes. Only the four formats
 * in `ALLOWED_LOGO_MIME` are recognized — anything else (including SVG, which
 * is XML and can carry script content) returns null and is rejected upstream.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedLogoMime | null {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}

	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}

	if (
		bytes.length >= 6 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return "image/gif";
	}

	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}

	return null;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] * 0x1000000 +
		((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
	);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] |
		(bytes[offset + 1] << 8) |
		(bytes[offset + 2] << 16) |
		(bytes[offset + 3] * 0x1000000)
	);
}

function matchesAscii(
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

function assertLogoDimensions(bytes: Uint8Array, mime: AllowedLogoMime): void {
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

export async function uploadOrganizationLogo({
	logo,
	storage,
}: {
	logo: OrganizationLogoInput;
	storage: OrganizationLogoStorage | null | undefined;
}): Promise<string> {
	const bytes = decodeBase64LogoData(logo.data);

	if (bytes.length === 0) {
		throw new LogoValidationError("Organization logo is empty.");
	}

	if (bytes.length > MAX_LOGO_BYTES) {
		throw new LogoValidationError("Organization logo exceeds maximum size.");
	}

	const sniffed = sniffImageMime(bytes);

	if (!sniffed) {
		throw new LogoValidationError(
			"Organization logo must be a PNG, JPEG, GIF, or WebP.",
		);
	}

	if (sniffed !== logo.contentType) {
		throw new LogoValidationError(
			"Organization logo content type does not match the file contents.",
		);
	}

	assertLogoDimensions(bytes, sniffed);

	if (!storage) {
		throw new Error("Organization logo storage is unavailable.");
	}

	const logoData = await storage.put(
		`${ORGANIZATION_LOGO_KEY_PREFIX}${crypto.randomUUID()}`,
		bytes,
		{
			httpMetadata: {
				contentType: sniffed,
			},
		},
	);

	return createOrganizationLogoUrl(logoData.key);
}
