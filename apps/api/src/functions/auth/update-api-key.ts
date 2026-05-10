import { recordAuditLog, recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { api_keys } from "@kayle-id/database/schema/core";
import { and, eq } from "drizzle-orm";
import type { ApiKeyScope } from "@/auth/permissions";
import { assertCanManageApiKeys } from "@/functions/auth/api-key-authorization";

/**
 * Update an API key.
 *
 * @param id - The ID of the API key to update
 * @param organizationId - The organization ID to update the API key for
 * @param options - Updatable options
 * @returns The status of the update
 */
export async function updateApiKey(
	id: string,
	organizationId: string,
	{
		actorUserId,
		name,
		enabled,
		permissions,
		metadata,
	}: {
		actorUserId?: string;
		name?: string;
		enabled?: boolean;
		permissions?: ApiKeyScope[];
		metadata?: Record<string, string | number | boolean>;
	},
): Promise<{ status: "success" | "error"; message?: string }> {
	const values = {
		name,
		enabled,
		permissions,
		metadata,
	};

	const updatedFields = Object.entries(values)
		.filter(([, value]) => value !== undefined)
		.map(([key]) => key);

	const updated = actorUserId
		? await db.transaction(async (tx) => {
				await assertCanManageApiKeys(tx, {
					organizationId,
					userId: actorUserId,
				});
				const [row] = await tx
					.update(api_keys)
					.set(values)
					.where(
						and(
							eq(api_keys.id, id),
							eq(api_keys.organizationId, organizationId),
						),
					)
					.returning({
						updatedId: api_keys.id,
					});

				if (row) {
					await recordAuditLog(
						{
							actorType: "user",
							actorUserId,
							organizationId,
							event: "api_key.updated",
							targetId: row.updatedId,
							targetType: "api_key",
							metadata: {
								updated_fields: updatedFields,
								...(enabled !== undefined ? { enabled } : {}),
							},
						},
						tx,
					);
				}

				return row;
			})
		: (
				await db
					.update(api_keys)
					.set(values)
					.where(
						and(
							eq(api_keys.id, id),
							eq(api_keys.organizationId, organizationId),
						),
					)
					.returning({
						updatedId: api_keys.id,
					})
			)[0];

	if (!updated?.updatedId) {
		return {
			status: "error",
			message: "API key not found",
		};
	}

	if (!actorUserId) {
		await recordAuditLogSafe({
			actorType: "system",
			organizationId,
			event: "api_key.updated",
			targetId: updated.updatedId,
			targetType: "api_key",
			metadata: {
				updated_fields: updatedFields,
				...(enabled !== undefined ? { enabled } : {}),
			},
		});
	}

	return {
		status: "success",
		message: "API key updated successfully",
	};
}
