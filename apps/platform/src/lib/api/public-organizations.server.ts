import { env } from "@/config/env";
import {
	DEFAULT_PUBLIC_ORGANIZATIONS_PAGINATION,
	type PublicOrganization,
	type PublicOrganizationDetailLoaderData,
	type PublicOrganizationsSearchLoaderData,
} from "./public-organizations";

interface ApiErrorPayload {
	message?: unknown;
}

interface ApiEnvelope<T> {
	data?: T | null;
	error?: ApiErrorPayload | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getApiErrorMessage(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const error = payload.error;

	if (!isRecord(error)) {
		return null;
	}

	return typeof error.message === "string" && error.message.length > 0
		? error.message
		: null;
}

async function requestPublicOrganizationApi<T>(
	path: string,
): Promise<ApiEnvelope<T>> {
	const response = await env.API.fetch(new URL(path, "http://api").toString(), {
		method: "GET",
	});
	const payload = (await response.json().catch(() => null)) as unknown;

	if (!response.ok) {
		throw new Error(
			getApiErrorMessage(payload) ??
				`Organization request failed with ${response.status}.`,
		);
	}

	if (!isRecord(payload) || !("data" in payload)) {
		throw new Error("Unable to load organizations.");
	}

	return payload as ApiEnvelope<T>;
}

export async function searchPublicOrganizationsOnServer({
	page,
	query,
}: {
	page: number;
	query: string;
}): Promise<PublicOrganizationsSearchLoaderData> {
	const fallbackPagination = {
		...DEFAULT_PUBLIC_ORGANIZATIONS_PAGINATION,
		page,
	};

	try {
		const searchParams = new URLSearchParams({ page: String(page) });
		if (query) {
			searchParams.set("query", query);
		}

		const payload = await requestPublicOrganizationApi<{
			organizations: PublicOrganization[];
			pagination: PublicOrganizationsSearchLoaderData["pagination"];
		}>(`/v1/verify/organizations?${searchParams.toString()}`);

		return {
			error: null,
			organizations: payload.data?.organizations ?? [],
			pagination: payload.data?.pagination ?? fallbackPagination,
		};
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: "Unable to search organizations.",
			organizations: [],
			pagination: fallbackPagination,
		};
	}
}

async function fetchOrganizationDetailOnServer({
	apiPath,
	identifier,
}: {
	apiPath: string;
	identifier: string;
}): Promise<PublicOrganizationDetailLoaderData> {
	if (!identifier) {
		return {
			error: "Organization identifier must be a slug or ID.",
			organization: null,
		};
	}

	try {
		const payload = await requestPublicOrganizationApi<{
			organization: PublicOrganization;
		}>(`${apiPath}/${encodeURIComponent(identifier)}`);

		return {
			error: null,
			organization: payload.data?.organization ?? null,
		};
	} catch (error) {
		return {
			error:
				error instanceof Error ? error.message : "Unable to load organization.",
			organization: null,
		};
	}
}

export function fetchPublicOrganizationOnServer({
	identifier,
}: {
	identifier: string;
}): Promise<PublicOrganizationDetailLoaderData> {
	return fetchOrganizationDetailOnServer({
		apiPath: "/v1/verify/organizations",
		identifier,
	});
}

export function fetchReportableOrganizationOnServer({
	identifier,
}: {
	identifier: string;
}): Promise<PublicOrganizationDetailLoaderData> {
	return fetchOrganizationDetailOnServer({
		apiPath: "/v1/verify/report-organizations",
		identifier,
	});
}
