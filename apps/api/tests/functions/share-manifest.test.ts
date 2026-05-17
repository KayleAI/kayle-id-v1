import { describe, expect, test } from "bun:test";
import { ERROR_MESSAGES } from "@kayle-id/translations/error-messages";
import { createKayleDocumentId } from "@/v1/sessions/domain/share-contract/kayle-document-id";
import { validateAndBuildShareManifest } from "@/v1/verify/share-manifest";
import {
	createDg1Artifact,
	createTd1MrzText,
	createTd3MrzText,
	createValidNfcArtifacts,
} from "../helpers/verify-artifacts";

describe("verify share manifest", () => {
	test("builds a canonical manifest from verified DG1 sources", async () => {
		const organizationId = "11111111-1111-4111-8111-111111111111";
		const dg1 = createDg1Artifact(createTd3MrzText());
		const artifacts = await createValidNfcArtifacts({
			dg1,
		});

		const result = await validateAndBuildShareManifest({
			contractVersion: 1,
			dg1: artifacts.dg1,
			now: new Date("2026-03-09T12:00:00.000Z"),
			organizationId,
			selectedFieldKeysInput: [
				"kayle_human_id",
				"nationality_code",
				"age_over_18",
				"kayle_document_id",
			],
			sessionId: "vs_123",
			submittedSessionId: "vs_123",
			shareFieldsInput: {
				kayle_human_id: {
					required: false,
					reason: "Human ID is optional.",
				},
				nationality_code: {
					required: false,
					reason: "Nationality code is optional.",
				},
				age_over_18: {
					required: false,
					reason: "Age confirmation is optional.",
				},
				kayle_document_id: {
					required: true,
					reason: "Document ID is required.",
				},
			},
		});

		expect(result.ok).toBeTrue();
		if (!result.ok) {
			return;
		}

		expect(result.shareReady).toEqual({
			sessionId: "vs_123",
			selectedFieldKeys: [
				"age_over_18",
				"kayle_document_id",
				"kayle_human_id",
				"nationality_code",
			],
		});

		expect(result.manifest.claims.age_over_18).toBeTrue();
		expect(result.manifest.claims.nationality_code).toBe("UTO");
		expect(result.manifest.claims.kayle_document_id).toBe(
			await createKayleDocumentId({
				organizationId,
				countryCode: "UTO",
				documentNumber: "L898902C3",
				documentType: "P",
			}),
		);
		expect(result.manifest.claims.kayle_human_id).toBeNull();
	});

	test("returns null for requested optional claims that were not selected", async () => {
		const organizationId = "11111111-1111-4111-8111-111111111111";
		const artifacts = await createValidNfcArtifacts();

		const result = await validateAndBuildShareManifest({
			contractVersion: 1,
			dg1: artifacts.dg1,
			now: new Date("2026-03-09T12:00:00.000Z"),
			organizationId,
			selectedFieldKeysInput: ["kayle_document_id"],
			sessionId: "vs_123",
			submittedSessionId: "vs_123",
			shareFieldsInput: {
				nationality_code: {
					required: false,
					reason: "Nationality code is optional.",
				},
				kayle_document_id: {
					required: true,
					reason: "Document ID is required.",
				},
			},
		});

		expect(result.ok).toBeTrue();
		if (!result.ok) {
			return;
		}

		expect(result.shareReady).toEqual({
			sessionId: "vs_123",
			selectedFieldKeys: ["kayle_document_id"],
		});
		expect(result.manifest.claims.nationality_code).toBeNull();
		expect(result.manifest.claims.kayle_document_id).toBe(
			await createKayleDocumentId({
				organizationId,
				countryCode: "UTO",
				documentNumber: "L898902C3",
				documentType: "P",
			}),
		);
	});

	test("rejects unknown selected field keys", async () => {
		const artifacts = await createValidNfcArtifacts();

		const result = await validateAndBuildShareManifest({
			contractVersion: 1,
			dg1: artifacts.dg1,
			organizationId: "11111111-1111-4111-8111-111111111111",
			selectedFieldKeysInput: ["unknown_claim", "kayle_document_id"],
			sessionId: "vs_123",
			submittedSessionId: "vs_123",
			shareFieldsInput: undefined,
		});

		expect(result).toEqual({
			ok: false,
			code: "SHARE_SELECTION_INVALID_FIELD",
			message: ERROR_MESSAGES.SHARE_SELECTION_INVALID_FIELD.description,
		});
	});

	test("rejects document photo selections from stale share contracts", async () => {
		const artifacts = await createValidNfcArtifacts();

		const result = await validateAndBuildShareManifest({
			contractVersion: 1,
			dg1: artifacts.dg1,
			organizationId: "11111111-1111-4111-8111-111111111111",
			selectedFieldKeysInput: ["document_photo", "kayle_document_id"],
			sessionId: "vs_123",
			submittedSessionId: "vs_123",
			shareFieldsInput: {
				document_photo: {
					required: false,
					reason: "Stale document photo request.",
				},
				kayle_document_id: {
					required: true,
					reason: "Document ID is required.",
				},
			},
		});

		expect(result).toEqual({
			ok: false,
			code: "SHARE_SELECTION_INVALID_FIELD",
			message: ERROR_MESSAGES.SHARE_SELECTION_INVALID_FIELD.description,
		});
	});

	test("rejects selections that omit required claims", async () => {
		const artifacts = await createValidNfcArtifacts();

		const result = await validateAndBuildShareManifest({
			contractVersion: 1,
			dg1: artifacts.dg1,
			organizationId: "11111111-1111-4111-8111-111111111111",
			selectedFieldKeysInput: ["nationality_code"],
			sessionId: "vs_123",
			submittedSessionId: "vs_123",
			shareFieldsInput: {
				nationality_code: {
					required: false,
					reason: "Nationality code is optional.",
				},
				kayle_document_id: {
					required: true,
					reason: "Document ID is required.",
				},
			},
		});

		expect(result).toEqual({
			ok: false,
			code: "SHARE_SELECTION_MISSING_REQUIRED",
			message: ERROR_MESSAGES.SHARE_SELECTION_MISSING_REQUIRED.description,
		});
	});

	test("builds a manifest from a TD1 ID card", async () => {
		const organizationId = "11111111-1111-4111-8111-111111111111";
		const dg1 = createDg1Artifact(createTd1MrzText());
		const artifacts = await createValidNfcArtifacts({ dg1 });

		const result = await validateAndBuildShareManifest({
			contractVersion: 1,
			dg1: artifacts.dg1,
			now: new Date("2026-03-09T12:00:00.000Z"),
			organizationId,
			selectedFieldKeysInput: [
				"document_type_code",
				"nationality_code",
				"kayle_document_id",
			],
			sessionId: "vs_123",
			submittedSessionId: "vs_123",
			shareFieldsInput: {
				document_type_code: {
					required: false,
					reason: "Document type is optional.",
				},
				nationality_code: {
					required: false,
					reason: "Nationality code is optional.",
				},
				kayle_document_id: {
					required: true,
					reason: "Document ID is required.",
				},
			},
		});

		expect(result.ok).toBeTrue();
		if (!result.ok) {
			return;
		}

		expect(result.manifest.claims.document_type_code).toBe("I");
		expect(result.manifest.claims.nationality_code).toBe("UTO");
		expect(result.manifest.claims.kayle_document_id).toBe(
			await createKayleDocumentId({
				organizationId,
				countryCode: "UTO",
				documentNumber: "D23145890",
				documentType: "I",
			}),
		);
	});
});
