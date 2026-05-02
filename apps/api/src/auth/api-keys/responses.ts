type ApiKeyAction = "create" | "delete" | "list" | "update";

type ApiKeyError = {
	code:
		| "API_KEY_NOT_DELETED"
		| "API_KEY_NOT_FOUND"
		| "FORBIDDEN"
		| "INTERNAL_SERVER_ERROR";
	docs: string;
	hint: string;
	message: string;
};

const ERROR_DOCS_URL = "https://kayle.id/docs/api/errors";
const DEFAULT_INTERNAL_ERROR_HINT = "Please try again in a few moments.";

export function createApiKeyErrorPayload(error: ApiKeyError) {
	return {
		data: null,
		error,
	} as const;
}

export function createApiKeyErrorPagePayload({
	error,
	limit,
}: {
	error: ApiKeyError;
	limit: number;
}) {
	return {
		...createApiKeyErrorPayload(error),
		pagination: {
			limit,
			has_more: false,
			next_cursor: null,
		},
	} as const;
}

export function createApiKeyForbiddenError(action: ApiKeyAction): ApiKeyError {
	return {
		code: "FORBIDDEN",
		message: `You are not authorized to ${action} API keys`,
		hint: "Please contact an administrator to request access.",
		docs: `${ERROR_DOCS_URL}#forbidden`,
	};
}
export function createApiKeyInternalServerError(
	hint = DEFAULT_INTERNAL_ERROR_HINT,
): ApiKeyError {
	return {
		code: "INTERNAL_SERVER_ERROR",
		message: "An unexpected error occurred",
		hint,
		docs: `${ERROR_DOCS_URL}#internal_server_error`,
	};
}
