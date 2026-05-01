import { parseErrorResponse } from "@/utils/parse-error-response";

export interface ApiError {
	code: string;
	docs?: string;
	hint?: string;
	message: string;
}

export interface Pagination {
	has_more: boolean;
	limit: number;
	next_cursor: string | null;
}

export type QueryValue = boolean | number | string | null | undefined;

interface RequestOptions {
	basePath: string;
	body?: unknown;
	method?: "DELETE" | "GET" | "PATCH" | "POST";
	path?: string;
	query?: Record<string, QueryValue>;
	unexpectedMessage: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPagination(value: unknown): value is Pagination {
	return (
		isRecord(value) &&
		typeof value.has_more === "boolean" &&
		typeof value.limit === "number" &&
		(value.next_cursor === null || typeof value.next_cursor === "string")
	);
}

function getEnvelopeErrorMessage(
	payload: Record<string, unknown>,
): string | null {
	const error = payload.error;

	if (error === null || error === undefined) {
		return null;
	}

	if (!isRecord(error)) {
		return null;
	}

	return typeof error.message === "string" && error.message.length > 0
		? error.message
		: null;
}

function buildQueryString(query?: Record<string, QueryValue>): string {
	if (!query) {
		return "";
	}

	const searchParams = new URLSearchParams();

	for (const [key, value] of Object.entries(query)) {
		if (
			value === undefined ||
			value === null ||
			value === "" ||
			value === "all"
		) {
			continue;
		}

		searchParams.set(key, String(value));
	}

	const serialized = searchParams.toString();
	return serialized ? `?${serialized}` : "";
}

async function fetchApiEnvelope({
	basePath,
	body,
	method = "GET",
	path = "",
	query,
	unexpectedMessage,
}: RequestOptions): Promise<unknown> {
	const response = await fetch(`${basePath}${path}${buildQueryString(query)}`, {
		body: body === undefined ? undefined : JSON.stringify(body),
		credentials: "include",
		headers:
			body === undefined ? undefined : { "Content-Type": "application/json" },
		method,
	});

	if (!response.ok) {
		throw new Error(
			await parseErrorResponse(
				response,
				`Request failed with ${response.status}.`,
			),
		);
	}

	try {
		return await response.json();
	} catch {
		throw new Error(unexpectedMessage);
	}
}

export async function requestApiResource<T>(
	options: RequestOptions,
): Promise<T> {
	const payload = await fetchApiEnvelope(options);

	if (!isRecord(payload) || !("data" in payload)) {
		throw new Error(options.unexpectedMessage);
	}

	const errorMessage = getEnvelopeErrorMessage(payload);
	if (errorMessage || payload.data === null || payload.data === undefined) {
		throw new Error(errorMessage ?? options.unexpectedMessage);
	}

	return payload.data as T;
}

export async function requestApiResourcePage<T>(
	options: RequestOptions,
): Promise<{ data: T[]; pagination: Pagination }> {
	const payload = await fetchApiEnvelope(options);

	if (!isRecord(payload) || !("data" in payload)) {
		throw new Error(options.unexpectedMessage);
	}

	const errorMessage = getEnvelopeErrorMessage(payload);
	if (errorMessage || payload.data === null || payload.data === undefined) {
		throw new Error(errorMessage ?? options.unexpectedMessage);
	}

	if (!Array.isArray(payload.data) || !isPagination(payload.pagination)) {
		throw new Error(options.unexpectedMessage);
	}

	return {
		data: payload.data as T[],
		pagination: payload.pagination,
	};
}
