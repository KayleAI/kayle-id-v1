import { normalizeShareFields } from "@/v1/sessions/domain/share-contract/normalize-share-fields";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";

const blockedShareFieldKeys = new Set(["document_photo"]);

const defaultNormalizedShareFields = (() => {
	const normalized = normalizeShareFields(undefined);

	if (!normalized.ok) {
		throw new Error("Failed to initialize default share fields.");
	}

	return normalized.shareFields;
})();

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function removeBlockedShareFields(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}

	const allowedFields: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(value)) {
		if (!blockedShareFieldKeys.has(key)) {
			allowedFields[key] = field;
		}
	}

	return allowedFields;
}

function readShareFieldSources(
	shareFieldsInput: unknown,
): Map<string, ShareFields[string]["source"]> {
	if (!isRecord(shareFieldsInput)) {
		return new Map();
	}

	const sources = new Map<string, ShareFields[string]["source"]>();
	for (const [key, field] of Object.entries(shareFieldsInput)) {
		if (!isRecord(field)) {
			continue;
		}

		if (field.source === "default" || field.source === "rc") {
			sources.set(key, field.source);
		}
	}

	return sources;
}

function applyExistingSources(
	shareFields: ShareFields,
	existingSources: Map<string, ShareFields[string]["source"]>,
): ShareFields {
	if (existingSources.size === 0) {
		return shareFields;
	}

	const nextShareFields: ShareFields = {};
	for (const [key, field] of Object.entries(shareFields)) {
		nextShareFields[key] = {
			...field,
			source: existingSources.get(key) ?? field.source,
		};
	}

	return nextShareFields;
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(",")}]`;
	}

	if (isRecord(value)) {
		const entries = Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(
				([key, entryValue]) =>
					`${JSON.stringify(key)}:${stableJson(entryValue)}`,
			);
		return `{${entries.join(",")}}`;
	}

	return JSON.stringify(value) ?? "null";
}

export function resolvePublicShareFields(
	shareFieldsInput: unknown,
): ShareFields {
	const allowedShareFieldsInput = removeBlockedShareFields(shareFieldsInput);
	const existingSources = readShareFieldSources(allowedShareFieldsInput);
	const normalized = normalizeShareFields(allowedShareFieldsInput);

	if (!normalized.ok) {
		return defaultNormalizedShareFields;
	}

	return applyExistingSources(normalized.shareFields, existingSources);
}

export function getShareFieldKeys(shareFields: ShareFields): string[] {
	return Object.keys(shareFields).sort((left, right) =>
		left.localeCompare(right),
	);
}

export async function computeShareContractHash(
	shareFields: ShareFields,
): Promise<string> {
	const payload = stableJson(shareFields);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(payload),
	);
	return bytesToHex(new Uint8Array(digest));
}
