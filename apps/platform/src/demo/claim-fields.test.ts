import { staticClaims } from "@kayle-id/config/share-claims";
import { expect, test } from "vitest";
import {
	buildRequestedShareFields,
	countVisibleDemoClaims,
	demoClaimSections,
	formatPublicDemoPayload,
	getClaimDescription,
} from "./claim-fields";

test("buildRequestedShareFields omits share_fields when every field is off", () => {
	const result = buildRequestedShareFields({
		ageThresholdText: "",
		fieldModes: {
			date_of_birth: "off",
			document_number: "off",
			kayle_document_id: "off",
		},
	});

	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(result.message);
	}

	expect(result.shareFields).toEqual({
		kayle_document_id: {
			reason: 'Sharing "Kayle Document ID"',
			required: true,
		},
		kayle_human_id: {
			reason: 'Sharing "Kayle Human ID"',
			required: true,
		},
	});
});

test("buildRequestedShareFields creates required and optional claims plus a single age gate", () => {
	const result = buildRequestedShareFields({
		ageThresholdText: "21",
		fieldModes: {
			document_number: "required",
			nationality_code: "optional",
			date_of_birth: "off",
			kayle_document_id: "off",
			kayle_human_id: "optional",
		},
	});

	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(result.message);
	}

	expect(result.shareFields).toEqual({
		age_over_21: {
			reason: 'Sharing "Age Over 21"',
			required: true,
		},
		document_number: {
			reason: 'Sharing "Document Number"',
			required: true,
		},
		nationality_code: {
			reason: 'Sharing "Nationality Code"',
			required: false,
		},
		kayle_document_id: {
			reason: 'Sharing "Kayle Document ID"',
			required: true,
		},
		kayle_human_id: {
			reason: 'Sharing "Kayle Human ID"',
			required: true,
		},
	});
});

test("buildRequestedShareFields allows DOB plus age gate together", () => {
	const result = buildRequestedShareFields({
		ageThresholdText: "18",
		fieldModes: {
			date_of_birth: "required",
		},
	});

	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(result.message);
	}

	expect(result.shareFields?.date_of_birth).toEqual({
		reason: 'Sharing "Date of Birth"',
		required: true,
	});
	expect(result.shareFields?.age_over_18).toEqual({
		reason: 'Sharing "Age Over 18"',
		required: true,
	});
});

test("buildRequestedShareFields rejects age gates below 12", () => {
	const result = buildRequestedShareFields({
		ageThresholdText: "11",
		fieldModes: {
			date_of_birth: "off",
		},
	});

	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error("expected_invalid_min_age_gate");
	}

	expect(result.message).toContain("between 12 and");
});

test("getClaimDescription avoids generic fallback copy for static claims", () => {
	for (const claimKey of staticClaims) {
		expect(getClaimDescription(claimKey).startsWith("Shares ")).toBe(false);
	}
});

test("getClaimDescription includes the requested threshold for age gates", () => {
	expect(getClaimDescription("age_over_21")).toContain("21");
	expect(getClaimDescription("age_over_21")).toContain(
		"without sharing the full date of birth",
	);
});

test("security section hides Kayle Human ID in public demo UI", () => {
	expect(
		demoClaimSections.find((section) => section.title === "Security"),
	).toEqual(
		expect.objectContaining({
			claims: ["kayle_document_id"],
		}),
	);
});

test("countVisibleDemoClaims excludes hidden public claims", () => {
	expect(
		countVisibleDemoClaims({
			kayle_document_id: {
				reason: 'Sharing "Kayle Document ID"',
				required: true,
			},
			kayle_human_id: {
				reason: 'Sharing "Kayle Human ID"',
				required: true,
			},
			nationality_code: {
				reason: 'Sharing "Nationality Code"',
				required: false,
			},
		}),
	).toBe(2);
});

test("formatPublicDemoPayload removes hidden claims from visible JSON", () => {
	expect(
		formatPublicDemoPayload(
			JSON.stringify({
				data: {
					claims: {
						kayle_document_id: "doc_123",
						kayle_human_id: null,
					},
					selected_field_keys: ["kayle_document_id", "kayle_human_id"],
				},
			}),
		),
	).toBe(
		JSON.stringify(
			{
				data: {
					claims: {
						kayle_document_id: "doc_123",
					},
					selected_field_keys: ["kayle_document_id"],
				},
			},
			null,
			2,
		),
	);
});
