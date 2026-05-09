import { db } from "@kayle-id/database/drizzle";
import { api_keys } from "@kayle-id/database/schema/core";
import { and, eq } from "drizzle-orm";
import { assertCanManageApiKeys } from "@/functions/auth/api-key-authorization";

/**
 * Verify an API key and return the organization ID and whether it is enabled.
 *
 * @param apiKey - The API key to verify
 * @returns The organization ID and whether it is enabled
 */
export async function deleteApiKey(
	id: string,
	organizationId: string,
	actorUserId?: string,
): Promise<{ status: "success" | "error"; message?: string }> {
	const deleted = actorUserId
		? await db.transaction(async (tx) => {
				await assertCanManageApiKeys(tx, {
					organizationId,
					userId: actorUserId,
				});
				const [row] = await tx
					.delete(api_keys)
					.where(
						and(
							eq(api_keys.id, id),
							eq(api_keys.organizationId, organizationId),
						),
					)
					.returning({
						deletedId: api_keys.id,
					});

				return row;
			})
		: (
				await db
					.delete(api_keys)
					.where(
						and(
							eq(api_keys.id, id),
							eq(api_keys.organizationId, organizationId),
						),
					)
					.returning({
						deletedId: api_keys.id,
					})
			)[0];

	if (!deleted?.deletedId) {
		return {
			status: "error",
			message: "API key not found",
		};
	}

	return { status: "success", message: "API key deleted successfully" };
}
