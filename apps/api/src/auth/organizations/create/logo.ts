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

function createLogoUrl(key: string): string {
	return process.env.NODE_ENV === "production"
		? `https://cdn.kayle.id/${key}`
		: `http://127.0.0.1:8787/r2/${key}`;
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

	if (!storage) {
		throw new Error("Organization logo storage is unavailable.");
	}

	const logoData = await storage.put(`logos/${crypto.randomUUID()}`, bytes, {
		httpMetadata: {
			contentType: sniffed,
		},
	});

	return createLogoUrl(logoData.key);
}
