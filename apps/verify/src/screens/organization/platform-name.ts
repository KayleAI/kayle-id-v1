export function getPlatformNameLabel(organizationName?: string | null): string {
	const trimmedOrganizationName = organizationName?.trim();
	return trimmedOrganizationName || "Platform Name";
}
