import {
	normalizeOrganizationAppealUrl,
	normalizeOrganizationComplaintsUrl,
	normalizeOrganizationFallbackIdvUrl,
	normalizeOrganizationPrivacyPolicyUrl,
	normalizeOrganizationSupportEmail,
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

export function parsePublicFallbackIdvUrl(
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	return parseWith(normalizeOrganizationFallbackIdvUrl, value);
}

export function parsePublicAppealUrl(
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	return parseWith(normalizeOrganizationAppealUrl, value);
}

export function parsePublicComplaintsUrl(
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	return parseWith(normalizeOrganizationComplaintsUrl, value);
}

export function parsePublicSupportEmail(
	value: null | string | undefined,
): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	try {
		return normalizeOrganizationSupportEmail(trimmed) ?? null;
	} catch {
		return null;
	}
}
