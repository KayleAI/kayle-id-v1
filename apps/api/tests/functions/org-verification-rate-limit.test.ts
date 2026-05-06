import { describe, expect, test } from "bun:test";
import { isAgeOnlyShareFields } from "@/v1/org-verification/rate-limit";
import { normalizeShareFields } from "@/v1/sessions/domain/share-contract/normalize-share-fields";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";

function buildShareFields(input: unknown): ShareFields {
	const normalized = normalizeShareFields(input);
	if (!normalized.ok) {
		throw new Error(`Invalid share fields fixture: ${normalized.error.code}`);
	}
	return normalized.shareFields;
}

describe("isAgeOnlyShareFields", () => {
	test("recognizes a single age_over_X claim as age-only", () => {
		const fields = buildShareFields({
			age_over_18: { required: true, reason: "Age verification" },
		});
		expect(isAgeOnlyShareFields(fields)).toBe(true);
	});

	test("treats age_over_X plus auto-injected kayle_document_id as age-only", () => {
		const fields = buildShareFields({
			age_over_21: { required: true, reason: "Age verification" },
		});
		// `kayle_document_id` is added automatically by the share-contract
		// normalizer; it must not disqualify the session from age-only treatment.
		expect("kayle_document_id" in fields).toBe(true);
		expect(isAgeOnlyShareFields(fields)).toBe(true);
	});

	test("rejects sessions that mix age claims with identity claims", () => {
		const fields = buildShareFields({
			age_over_18: { required: true, reason: "Age verification" },
			given_names: { required: true, reason: "KYC" },
		});
		expect(isAgeOnlyShareFields(fields)).toBe(false);
	});

	test("rejects sessions with no age claim at all", () => {
		const fields = buildShareFields({
			given_names: { required: true, reason: "KYC" },
			family_name: { required: true, reason: "KYC" },
		});
		expect(isAgeOnlyShareFields(fields)).toBe(false);
	});

	test("rejects default share field set (just kayle_document_id)", () => {
		const fields = buildShareFields(undefined);
		// Default share fields include only `kayle_document_id` as required and
		// no age gate, so the session is treated as identity-revealing.
		expect(isAgeOnlyShareFields(fields)).toBe(false);
	});
});
