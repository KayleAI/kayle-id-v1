import type { ApiKey } from "@kayle-id/auth/types";
import {
	type Pagination,
	requestApiResource,
	requestApiResourcePage,
} from "@/utils/api-client";

const API_KEYS_PATH = "/api/auth/api-keys";

export const API_KEYS_QUERY_KEY = ["api-keys"] as const;

const UNEXPECTED_API_KEY_RESPONSE = "Unexpected API key response.";

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
}: {
	name: string;
}): Promise<CreateApiKeyResult> {
	return requestApiResource<CreateApiKeyResult>({
		basePath: API_KEYS_PATH,
		body: { name },
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
