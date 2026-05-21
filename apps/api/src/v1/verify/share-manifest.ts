import type {
	VerifyShareReady,
	VerifyShareRequest,
} from "@kayle-id/capnp/verify-codec";
import { ERROR_MESSAGES } from "@kayle-id/translations/error-messages";
import {
	isAgeOverClaim,
	parseAgeOverThreshold,
} from "@/v1/sessions/domain/share-contract/claim-catalog";
import { createKayleDocumentId } from "@/v1/sessions/domain/share-contract/kayle-document-id";
import {
	ageFromDateOfBirth,
	type Dg1Claims,
	parseDg1Claims,
} from "./dg1-claims";
import { resolvePublicShareFields } from "./public-share-fields";

type ShareSelectionValidationCode =
	| "INVALID_SESSION_ID"
	| "SHARE_SELECTION_REQUIRED"
	| "SHARE_SELECTION_INVALID_FIELD"
	| "SHARE_SELECTION_MISSING_REQUIRED";

export type VerifyShareClaimValue = boolean | string | null;

export type VerifyShareManifest = {
	contractVersion: number;
	claims: Record<string, VerifyShareClaimValue>;
	selectedFieldKeys: string[];
	sessionId: string;
};

function resolveErrorMessage(code: ShareSelectionValidationCode): string {
	return ERROR_MESSAGES[code].description;
}

async function buildShareClaimValue({
	claimKey,
	dg1Claims,
	now,
	organizationId,
}: {
	claimKey: string;
	dg1Claims: Dg1Claims;
	now: Date;
	organizationId: string;
}): Promise<VerifyShareClaimValue> {
	switch (claimKey) {
		case "document_type_code":
			return dg1Claims.documentType;
		case "issuing_country_code":
			return dg1Claims.issuingCountry;
		case "family_name":
			return dg1Claims.surname;
		case "given_names":
			return dg1Claims.givenNames;
		case "document_number":
			return dg1Claims.documentNumber;
		case "nationality_code":
			return dg1Claims.nationality;
		case "date_of_birth":
			return dg1Claims.birthDateIso;
		case "sex_marker":
			return dg1Claims.sex;
		case "document_expiry_date":
			return dg1Claims.expiryDateIso;
		case "mrz_optional_data":
			return dg1Claims.optionalData;
		case "kayle_document_id":
			return await createKayleDocumentId({
				organizationId,
				countryCode: dg1Claims.issuingCountry,
				documentNumber: dg1Claims.documentNumber,
				documentType: dg1Claims.documentType,
			});
		case "kayle_human_id":
			return null;
		default: {
			if (!isAgeOverClaim(claimKey)) {
				throw new Error(`unsupported_share_claim:${claimKey}`);
			}

			const threshold = parseAgeOverThreshold(claimKey);

			if (!threshold) {
				throw new Error(`invalid_age_over_claim:${claimKey}`);
			}

			return ageFromDateOfBirth(dg1Claims.birthDateIso, now) >= threshold;
		}
	}
}

function normalizeSelectedFieldKeys({
	availableFields,
	selectedFieldKeysInput,
}: {
	availableFields: VerifyShareRequest["fields"];
	selectedFieldKeysInput: string[] | undefined;
}):
	| {
			ok: true;
			selectedFieldKeys: string[];
	  }
	| {
			code: ShareSelectionValidationCode;
			message: string;
			ok: false;
	  } {
	if (
		!(selectedFieldKeysInput && Array.isArray(selectedFieldKeysInput)) ||
		selectedFieldKeysInput.length === 0
	) {
		return {
			ok: false,
			code: "SHARE_SELECTION_REQUIRED",
			message: resolveErrorMessage("SHARE_SELECTION_REQUIRED"),
		};
	}

	const selectedFieldKeySet = new Set(
		selectedFieldKeysInput
			.map((value) => value.trim())
			.filter((value) => value.length > 0),
	);

	if (selectedFieldKeySet.size === 0) {
		return {
			ok: false,
			code: "SHARE_SELECTION_REQUIRED",
			message: resolveErrorMessage("SHARE_SELECTION_REQUIRED"),
		};
	}

	const availableFieldKeySet = new Set(
		availableFields.map((field) => field.key),
	);

	for (const key of selectedFieldKeySet) {
		if (!availableFieldKeySet.has(key)) {
			return {
				ok: false,
				code: "SHARE_SELECTION_INVALID_FIELD",
				message: resolveErrorMessage("SHARE_SELECTION_INVALID_FIELD"),
			};
		}
	}

	const missingRequiredField = availableFields.some(
		(field) => field.required && !selectedFieldKeySet.has(field.key),
	);

	if (missingRequiredField) {
		return {
			ok: false,
			code: "SHARE_SELECTION_MISSING_REQUIRED",
			message: resolveErrorMessage("SHARE_SELECTION_MISSING_REQUIRED"),
		};
	}

	return {
		ok: true,
		selectedFieldKeys: availableFields
			.filter((field) => selectedFieldKeySet.has(field.key))
			.map((field) => field.key),
	};
}

export function createShareRequestPayload({
	contractVersion,
	sessionId,
	shareFieldsInput,
}: {
	contractVersion: number;
	sessionId: string;
	shareFieldsInput: unknown;
}): VerifyShareRequest {
	const shareFields = resolvePublicShareFields(shareFieldsInput);

	return {
		contractVersion,
		sessionId,
		fields: Object.entries(shareFields).map(([key, field]) => ({
			key,
			reason: field.reason,
			required: field.required,
		})),
	};
}

export async function validateAndBuildShareManifest({
	contractVersion,
	dg1,
	now = new Date(),
	organizationId,
	selectedFieldKeysInput,
	sessionId,
	submittedSessionId,
	shareFieldsInput,
}: {
	contractVersion: number;
	dg1: Uint8Array;
	now?: Date;
	organizationId: string;
	selectedFieldKeysInput: string[] | undefined;
	sessionId: string;
	submittedSessionId: string | undefined;
	shareFieldsInput: unknown;
}): Promise<
	| {
			manifest: VerifyShareManifest;
			ok: true;
			shareReady: VerifyShareReady;
			dg1Claims: Dg1Claims;
	  }
	| {
			code: ShareSelectionValidationCode;
			message: string;
			ok: false;
	  }
> {
	if (submittedSessionId?.trim() !== sessionId) {
		return {
			ok: false,
			code: "INVALID_SESSION_ID",
			message: resolveErrorMessage("INVALID_SESSION_ID"),
		};
	}

	const shareRequest = createShareRequestPayload({
		contractVersion,
		sessionId,
		shareFieldsInput,
	});
	const selection = normalizeSelectedFieldKeys({
		availableFields: shareRequest.fields,
		selectedFieldKeysInput,
	});

	if (!selection.ok) {
		return selection;
	}

	const dg1Claims = parseDg1Claims(dg1, now);
	const selectedFieldKeySet = new Set(selection.selectedFieldKeys);
	const claimEntries = await Promise.all(
		shareRequest.fields.map(
			async (field) =>
				[
					field.key,
					selectedFieldKeySet.has(field.key)
						? await buildShareClaimValue({
								claimKey: field.key,
								dg1Claims,
								now,
								organizationId,
							})
						: null,
				] as const,
		),
	);
	const claims = Object.fromEntries(claimEntries);

	return {
		ok: true,
		shareReady: {
			sessionId,
			selectedFieldKeys: selection.selectedFieldKeys,
		},
		manifest: {
			contractVersion,
			claims,
			selectedFieldKeys: selection.selectedFieldKeys,
			sessionId,
		},
		dg1Claims,
	};
}
