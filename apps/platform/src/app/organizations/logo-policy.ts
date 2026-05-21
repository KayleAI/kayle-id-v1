const ALLOWED_ORGANIZATION_LOGO_MIME = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;

export const ORGANIZATION_LOGO_ACCEPT =
	ALLOWED_ORGANIZATION_LOGO_MIME.join(",");
export const ORGANIZATION_LOGO_FORMAT_LABEL = "PNG, JPEG, GIF, or WebP";
export const MAX_ORGANIZATION_LOGO_BYTES = 1024 * 1024;

const allowedOrganizationLogoMime = new Set<string>(
	ALLOWED_ORGANIZATION_LOGO_MIME,
);

export function getOrganizationLogoFileError(file: File): string | null {
	if (!allowedOrganizationLogoMime.has(file.type)) {
		return `Please select a ${ORGANIZATION_LOGO_FORMAT_LABEL} image.`;
	}

	if (file.size > MAX_ORGANIZATION_LOGO_BYTES) {
		return "Logo must be 1 MB or smaller.";
	}

	return null;
}
