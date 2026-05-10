import { recordAuditLog, recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
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

				if (row) {
					await recordAuditLog(
						{
							actorType: "user",
							actorUserId,
							organizationId,
							event: "api_key.deleted",
							targetId: row.deletedId,
							targetType: "api_key",
						},
						tx,
					);
				}

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

	if (!actorUserId) {
		await recordAuditLogSafe({
			actorType: "system",
			organizationId,
			event: "api_key.deleted",
			targetId: deleted.deletedId,
			targetType: "api_key",
		});
	}

	return { status: "success", message: "API key deleted successfully" };
}
