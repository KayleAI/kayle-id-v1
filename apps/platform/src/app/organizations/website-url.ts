import {
	normalizeOrganizationPrivacyPolicyUrl,
	normalizeOrganizationTermsOfServiceUrl,
	normalizeOrganizationWebsiteUrl,
} from "@kayle-id/auth/organization-metadata";

export interface PublicWebsiteUrl {
	href: string;
	label: string;
}

type Normalizer = (value: unknown) => null | string | undefined;

function parseWith(
	normalize: Normalizer,
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const href = normalize(trimmed);
		return href ? { href, label: trimmed } : null;
	} catch {
		return null;
	}
}

export function parsePublicWebsiteUrl(
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	return parseWith(normalizeOrganizationWebsiteUrl, value);
}

export function parsePublicPrivacyPolicyUrl(
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	return parseWith(normalizeOrganizationPrivacyPolicyUrl, value);
}

export function parsePublicTermsOfServiceUrl(
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	return parseWith(normalizeOrganizationTermsOfServiceUrl, value);
}
