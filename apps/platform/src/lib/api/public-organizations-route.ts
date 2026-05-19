import { createServerFn } from "@tanstack/react-start";
import type {
	PublicOrganizationDetailLoaderData,
	PublicOrganizationsSearchLoaderData,
} from "./public-organizations";
import type { ReportableOrganization } from "./report";

interface ReportOrganizationDetailLoaderData {
	error: null | string;
	organization: ReportableOrganization | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseServerFunctionInput(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function parsePositiveInteger(value: unknown): number {
	const page = typeof value === "number" ? value : Number(value);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

function validateSearchInput(value: unknown): { page: number; query: string } {
	const input = parseServerFunctionInput(value);
	return {
		page: parsePositiveInteger(input.page),
		query: typeof input.query === "string" ? input.query.trim() : "",
	};
}

function validateIdentifierInput(value: unknown): { identifier: string } {
	const input = parseServerFunctionInput(value);
	return {
		identifier:
			typeof input.identifier === "string" ? input.identifier.trim() : "",
	};
}

export const searchPublicOrganizationsForRoute = createServerFn({
	method: "GET",
})
	.inputValidator(validateSearchInput)
	.handler(async ({ data }): Promise<PublicOrganizationsSearchLoaderData> => {
		const { searchPublicOrganizationsOnServer } = await import(
			"./public-organizations.server"
		);
		return searchPublicOrganizationsOnServer(data);
	});

export const fetchPublicOrganizationForRoute = createServerFn({
	method: "GET",
})
	.inputValidator(validateIdentifierInput)
	.handler(async ({ data }): Promise<PublicOrganizationDetailLoaderData> => {
		const { fetchPublicOrganizationOnServer } = await import(
			"./public-organizations.server"
		);
		return fetchPublicOrganizationOnServer(data);
	});

export const fetchReportableOrganizationForRoute = createServerFn({
	method: "GET",
})
	.inputValidator(validateIdentifierInput)
	.handler(async ({ data }): Promise<ReportOrganizationDetailLoaderData> => {
		const { fetchReportableOrganizationOnServer } = await import(
			"./public-organizations.server"
		);
		return fetchReportableOrganizationOnServer(data);
	});
