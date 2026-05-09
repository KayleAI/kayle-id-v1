import { getOrgDeletionState } from "@kayle-id/auth/organization-deletion";

export async function isPublicVerifySessionHidden(
	organizationId: string,
): Promise<boolean> {
	const deletion = await getOrgDeletionState(organizationId);
	return Boolean(deletion?.pendingDeletionAt);
}
