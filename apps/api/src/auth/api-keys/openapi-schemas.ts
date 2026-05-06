import { z } from "@hono/zod-openapi";
import { CUSTOMER_API_KEY_SCOPES } from "@/auth/permissions";

const ApiKeyMetadataValue = z.union([z.string(), z.number(), z.boolean()]);

export const ApiKeyMetadata = z.record(z.string(), ApiKeyMetadataValue);

export const ApiKeyIdParam = z.object({
	id: z.string().min(1),
});

// Customer-facing endpoints (`/api/auth/api-keys`) only accept customer scopes.
// `org_verifications:write` is platform-internal and is never grantable from
// outside; the platform's own key is provisioned out-of-band.
const ApiKeyScopeArray = z.array(z.enum(CUSTOMER_API_KEY_SCOPES));

export const ApiKeyCreateRequest = z.object({
	name: z.string().min(1),
	permissions: ApiKeyScopeArray.min(1),
	metadata: ApiKeyMetadata.optional(),
});

export const ApiKeyUpdateRequest = z.object({
	name: z.string().min(1).optional(),
	enabled: z.boolean().optional(),
	permissions: ApiKeyScopeArray.min(1).optional(),
	metadata: ApiKeyMetadata.optional(),
});

export const ApiKeyCreatedResponse = z.object({
	data: z.object({
		id: z.string(),
		key: z.string(),
	}),
	error: z.null(),
});

export const ApiKeyMutationResponse = z.object({
	data: z.object({
		status: z.literal("success"),
		message: z.string(),
	}),
	error: z.null(),
});

export const ApiKeyListItem = z.object({
	id: z.string(),
	name: z.string(),
	enabled: z.boolean(),
	permissions: z.array(z.string()),
	metadata: ApiKeyMetadata,
	createdAt: z.date(),
	updatedAt: z.date(),
	requestCount: z.number(),
});
