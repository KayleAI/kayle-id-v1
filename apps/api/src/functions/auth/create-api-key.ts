import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { api_keys } from "@kayle-id/database/schema/core";
import type { ApiKeyScope } from "@/auth/permissions";
import { createHMAC } from "@/functions/hmac";
import { generateId } from "@/utils/generate-id";

/**
 * Create an API key and return the key hash.
 *
 * @param organizationId - The organization ID to create the API key for
 * @returns The API key hash
 */
export async function createApiKey({
	name,
	organizationId,
	metadata = {},
	permissions,
}: {
	name: string;
	organizationId: string;
	permissions: ApiKeyScope[];
	metadata?: Record<string, string | number | boolean>;
}): Promise<{ id: string; apiKey: string }> {
	const environment = "live";
	const apiKey = generateId({ type: "kk", environment, length: 32 });

	const keyHash = await createHMAC(apiKey, {
		algorithm: "SHA256",
		secret: env.AUTH_SECRET,
	});

	const [created] = await db
		.insert(api_keys)
		.values({
			name,
			organizationId,
			environment,
			keyHash,
			permissions,
			metadata,
		})
		.returning({
			id: api_keys.id,
		});

	if (!created?.id) {
		throw new Error("Failed to create API key");
	}

	return {
		id: created.id,
		apiKey,
	};
}
