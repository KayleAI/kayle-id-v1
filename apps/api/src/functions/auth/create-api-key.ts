import { recordAuditLog, recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { api_keys } from "@kayle-id/database/schema/core";
import type { ApiKeyScope } from "@/auth/permissions";
import { assertCanManageApiKeys } from "@/functions/auth/api-key-authorization";
import { createHMAC } from "@/functions/hmac";
import { generateId } from "@/utils/generate-id";

/**
 * Create an API key and return the key hash.
 *
 * @param organizationId - The organization ID to create the API key for
 * @returns The API key hash
 */
export async function createApiKey({
	actorUserId,
	name,
	organizationId,
	metadata = {},
	permissions,
}: {
	actorUserId?: string;
	name: string;
	organizationId: string;
	permissions: ApiKeyScope[];
	metadata?: Record<string, string | number | boolean>;
}): Promise<{ id: string; apiKey: string }> {
	const apiKey = generateId({ type: "kk", length: 32 });

	const keyHash = await createHMAC(apiKey, {
		algorithm: "SHA256",
		secret: env.AUTH_SECRET,
	});

	const values = {
		name,
		organizationId,
		keyHash,
		permissions,
		metadata,
	};

	const created = actorUserId
		? await db.transaction(async (tx) => {
				await assertCanManageApiKeys(tx, {
					organizationId,
					userId: actorUserId,
				});
				const [row] = await tx.insert(api_keys).values(values).returning({
					id: api_keys.id,
				});
				if (row) {
					await recordAuditLog(
						{
							actorType: "user",
							actorUserId,
							organizationId,
							event: "api_key.created",
							targetId: row.id,
							targetType: "api_key",
							metadata: { name, permissions },
						},
						tx,
					);
				}
				return row;
			})
		: (
				await db.insert(api_keys).values(values).returning({
					id: api_keys.id,
				})
			)[0];

	if (!created?.id) {
		throw new Error("Failed to create API key");
	}

	if (!actorUserId) {
		await recordAuditLogSafe({
			actorType: "system",
			organizationId,
			event: "api_key.created",
			targetId: created.id,
			targetType: "api_key",
			metadata: { name, permissions },
		});
	}

	return {
		id: created.id,
		apiKey,
	};
}
