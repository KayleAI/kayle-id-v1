import { z } from "@hono/zod-openapi";
import { CUSTOMER_API_KEY_SCOPES } from "@/auth/permissions";

const API_KEY_NAME_MAX_LENGTH = 120;
const API_KEY_METADATA_MAX_KEYS = 20;
const API_KEY_METADATA_KEY_MAX_LENGTH = 64;
const API_KEY_METADATA_STRING_MAX_LENGTH = 512;
const API_KEY_METADATA_KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/u;

export const ApiKeyId = z.string().uuid();

const ApiKeyName = z.string().trim().min(1).max(API_KEY_NAME_MAX_LENGTH);

const ApiKeyMetadataKey = z
	.string()
	.min(1)
	.max(API_KEY_METADATA_KEY_MAX_LENGTH)
	.regex(API_KEY_METADATA_KEY_PATTERN);

const ApiKeyMetadataValue = z.union([
	z.string().max(API_KEY_METADATA_STRING_MAX_LENGTH),
	z.number().finite(),
	z.boolean(),
]);

export const ApiKeyMetadata = z
	.record(ApiKeyMetadataKey, ApiKeyMetadataValue)
	.refine(
		(metadata) => Object.keys(metadata).length <= API_KEY_METADATA_MAX_KEYS,
		{
			message: `API key metadata must have at most ${API_KEY_METADATA_MAX_KEYS} keys`,
		},
	);

export const ApiKeyIdParam = z.object({
	id: ApiKeyId,
});

// Customer-facing endpoints (`/api/auth/api-keys`) only accept customer scopes.
const ApiKeyScopeArray = z.array(z.enum(CUSTOMER_API_KEY_SCOPES));

export const ApiKeyCreateRequest = z.object({
	name: ApiKeyName,
	permissions: ApiKeyScopeArray.min(1),
	metadata: ApiKeyMetadata.optional(),
});

export const ApiKeyUpdateRequest = z.object({
	name: ApiKeyName.optional(),
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
