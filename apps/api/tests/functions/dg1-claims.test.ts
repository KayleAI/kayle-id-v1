import { describe, expect, test } from "bun:test";
import {
	MAX_FACE_MATCH_THRESHOLD,
	MIN_FACE_MATCH_THRESHOLD,
	parseDg1Claims,
	resolveFaceMatchThresholdFromDg1,
} from "@/v1/verify/dg1-claims";
import { DEFAULT_FACE_MATCH_THRESHOLD } from "@/v1/verify/validation-types";
import {
	createDg1Artifact,
	createTd1MrzText,
	createTd2MrzText,
} from "../helpers/verify-artifacts";

const TD3_LINE_ONE = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";

function toMrzDate(dateIso: string): string {
	return `${dateIso.slice(2, 4)}${dateIso.slice(5, 7)}${dateIso.slice(8, 10)}`;
}

function createTd3MrzText({
	birthDateIso,
	expiryDateIso,
}: {
	birthDateIso: string;
	expiryDateIso: string;
}): string {
	return [
		TD3_LINE_ONE,
		`L898902C36UTO${toMrzDate(birthDateIso)}2F${toMrzDate(
			expiryDateIso,
		)}9ZE184226B<<<<<10`,
	].join("\n");
}

function createDg1({
	birthDateIso,
	expiryDateIso,
}: {
	birthDateIso: string;
	expiryDateIso: string;
}): Uint8Array {
	return createDg1Artifact(
		createTd3MrzText({
			birthDateIso,
			expiryDateIso,
		}),
	);
}

describe("DG1 face match thresholds", () => {
	test("resolves a dynamic adult threshold from age at issue and document age", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1({
				birthDateIso: "2004-04-18",
				expiryDateIso: "2030-04-19",
			}),
			now: new Date("2025-04-19T00:00:00.000Z"),
		});

		// Formula yields 0.685, which now clamps up to MIN=0.6875
		// under the AuraFace-calibrated window. The dynamic path is
		// still exercised (the formula runs); the result happens to
		// hit the floor because raw cosine 0.375 is the IDV-safe
		// minimum.
		expect(threshold).toBe(MIN_FACE_MATCH_THRESHOLD);
	});

	test("resolves a dynamic child threshold from age at issue and document age", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1({
				birthDateIso: "2007-04-18",
				expiryDateIso: "2027-04-19",
			}),
			now: new Date("2026-04-19T00:00:00.000Z"),
		});

		// Formula yields 0.652 → clamped to MIN. Same shape as the
		// adult dynamic case above; the explicit "fully aged"
		// clamping test below covers the all-the-way-to-expiry edge.
		expect(threshold).toBe(MIN_FACE_MATCH_THRESHOLD);
	});

	test("clamps to the maximum threshold for a fresh adult document", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1({
				birthDateIso: "1990-04-18",
				expiryDateIso: "2036-04-19",
			}),
			now: new Date("2026-04-19T00:00:00.000Z"),
		});

		expect(threshold).toBe(MAX_FACE_MATCH_THRESHOLD);
	});

	test("clamps to the minimum threshold for a fully aged child document", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1({
				birthDateIso: "2010-04-18",
				expiryDateIso: "2027-04-19",
			}),
			now: new Date("2027-04-19T00:00:00.000Z"),
		});

		expect(threshold).toBe(MIN_FACE_MATCH_THRESHOLD);
	});

	test("falls back to the default threshold when document validity is ambiguous", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1({
				birthDateIso: "2004-04-18",
				expiryDateIso: "2028-04-19",
			}),
			now: new Date("2026-04-19T00:00:00.000Z"),
		});

		expect(threshold).toBe(DEFAULT_FACE_MATCH_THRESHOLD);
	});

	test("returns the default threshold for a TD1 ID card regardless of birth/expiry", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1Artifact(
				createTd1MrzText({
					birthDateIso: "2004-04-18",
					expiryDateIso: "2030-04-19",
				}),
			),
			now: new Date("2025-04-19T00:00:00.000Z"),
		});

		expect(threshold).toBe(DEFAULT_FACE_MATCH_THRESHOLD);
	});

	test("returns the default threshold for a TD2 ID card regardless of birth/expiry", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1Artifact(
				createTd2MrzText({
					birthDateIso: "1990-04-18",
					expiryDateIso: "2036-04-19",
				}),
			),
			now: new Date("2026-04-19T00:00:00.000Z"),
		});

		expect(threshold).toBe(DEFAULT_FACE_MATCH_THRESHOLD);
	});
});

describe("parseDg1Claims", () => {
	test("parses a TD1 ID card into format-agnostic claims", () => {
		const claims = parseDg1Claims(
			createDg1Artifact(
				createTd1MrzText({
					birthDateIso: "1974-08-12",
					expiryDateIso: "2030-04-15",
				}),
			),
			new Date("2026-05-08T00:00:00.000Z"),
		);

		expect(claims.documentType).toBe("I");
		expect(claims.issuingCountry).toBe("UTO");
		expect(claims.documentNumber).toBe("D23145890");
		expect(claims.nationality).toBe("UTO");
		expect(claims.birthDateIso).toBe("1974-08-12");
		expect(claims.expiryDateIso).toBe("2030-04-15");
		expect(claims.surname).toBe("ERIKSSON");
		expect(claims.givenNames).toBe("ANNA MARIA");
		expect(claims.sex).toBe("F");
	});

	test("parses a TD2 ID card into format-agnostic claims", () => {
		const claims = parseDg1Claims(
			createDg1Artifact(
				createTd2MrzText({
					birthDateIso: "1974-08-12",
					expiryDateIso: "2030-04-15",
				}),
			),
			new Date("2026-05-08T00:00:00.000Z"),
		);

		expect(claims.documentType).toBe("I");
		expect(claims.issuingCountry).toBe("UTO");
		expect(claims.documentNumber).toBe("D23145890");
		expect(claims.nationality).toBe("UTO");
		expect(claims.birthDateIso).toBe("1974-08-12");
		expect(claims.expiryDateIso).toBe("2030-04-15");
		expect(claims.surname).toBe("ERIKSSON");
		expect(claims.givenNames).toBe("ANNA MARIA");
		expect(claims.sex).toBe("F");
	});
});
