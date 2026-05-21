import {
	createOrganizationLogoUrl,
	ORGANIZATION_LOGO_KEY_PREFIX,
} from "@kayle-id/auth/organization-logo";
import { decodeBase64LogoData } from "./logo-base64";
import { assertLogoDimensions } from "./logo-dimensions";
import { sniffImageMime } from "./logo-mime";
import {
	LogoValidationError,
	MAX_LOGO_BYTES,
	type OrganizationLogoInput,
	type OrganizationLogoStorage,
} from "./logo-policy";

export { sniffImageMime } from "./logo-mime";
export {
	ALLOWED_LOGO_MIME,
	type AllowedLogoMime,
	LogoValidationError,
	MAX_LOGO_BYTES,
	MAX_LOGO_DIMENSION,
} from "./logo-policy";

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
