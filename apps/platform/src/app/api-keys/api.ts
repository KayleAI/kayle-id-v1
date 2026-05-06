import {
	CUSTOMER_API_KEY_SCOPES,
	type CustomerApiKeyScope,
} from "@kayle-id/auth/permissions";
import type { ApiKey } from "@kayle-id/auth/types";
import {
	type Pagination,
	requestApiResource,
	requestApiResourcePage,
} from "@/utils/api-client";

const API_KEYS_PATH = "/api/auth/api-keys";

export const API_KEYS_QUERY_KEY = ["api-keys"] as const;

const UNEXPECTED_API_KEY_RESPONSE = "Unexpected API key response.";

// TODO: surface scope selection in the create modal so users can issue
// least-privilege keys. Until then, the dashboard issues fully-scoped keys
// limited to customer-permitted scopes — `org_verifications:write` is
// platform-internal and must never appear on a customer key.
const DEFAULT_API_KEY_PERMISSIONS: readonly CustomerApiKeyScope[] =
	CUSTOMER_API_KEY_SCOPES;

interface ApiKeyMutationResult {
	message: string;
	status: "success";
}

interface CreateApiKeyResult {
	id: string;
	key: string;
}

interface ListApiKeysResult {
	data: ApiKey[];
	pagination: Pagination;
}

interface UpdateApiKeyInput {
	enabled?: boolean;
	id: string;
	name?: string;
}

export function listApiKeys(): Promise<ListApiKeysResult> {
	return requestApiResourcePage<ApiKey>({
		basePath: API_KEYS_PATH,
		unexpectedMessage: UNEXPECTED_API_KEY_RESPONSE,
	});
}

export function createApiKey({
	name,
	permissions = DEFAULT_API_KEY_PERMISSIONS,
}: {
	name: string;
	permissions?: readonly CustomerApiKeyScope[];
}): Promise<CreateApiKeyResult> {
	return requestApiResource<CreateApiKeyResult>({
		basePath: API_KEYS_PATH,
		body: { name, permissions },
		method: "POST",
		unexpectedMessage: UNEXPECTED_API_KEY_RESPONSE,
	});
}

export function updateApiKey({
	enabled,
	id,
	name,
}: UpdateApiKeyInput): Promise<ApiKeyMutationResult> {
	return requestApiResource<ApiKeyMutationResult>({
		basePath: API_KEYS_PATH,
		body: {
			enabled,
			name,
		},
		method: "PATCH",
		path: `/${id}`,
		unexpectedMessage: UNEXPECTED_API_KEY_RESPONSE,
	});
}

export function deleteApiKey(id: string): Promise<ApiKeyMutationResult> {
	return requestApiResource<ApiKeyMutationResult>({
		basePath: API_KEYS_PATH,
		method: "DELETE",
		path: `/${id}`,
		unexpectedMessage: UNEXPECTED_API_KEY_RESPONSE,
	});
}
