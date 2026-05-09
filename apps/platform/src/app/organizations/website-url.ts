import { normalizeOrganizationWebsiteUrl } from "@kayle-id/auth/organization-metadata";

export interface PublicWebsiteUrl {
	href: string;
	label: string;
}

export function parsePublicWebsiteUrl(
	value: null | string | undefined,
): PublicWebsiteUrl | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const href = normalizeOrganizationWebsiteUrl(trimmed);
		return href ? { href, label: trimmed } : null;
	} catch {
		return null;
	}
}
