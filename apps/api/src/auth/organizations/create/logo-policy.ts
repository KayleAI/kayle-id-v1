export type OrganizationLogoInput = {
	contentType: string;
	data: string;
};

export type OrganizationLogoStorage = {
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

export class LogoValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LogoValidationError";
	}
}
