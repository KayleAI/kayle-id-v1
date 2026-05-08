import { describe, expect, test } from "bun:test";
import {
	MAX_FACE_MATCH_THRESHOLD,
	MIN_FACE_MATCH_THRESHOLD,
	resolveFaceMatchThresholdFromDg1,
} from "@/v1/verify/dg1-claims";
import { DEFAULT_FACE_MATCH_THRESHOLD } from "@/v1/verify/validation-types";
import { createDg1Artifact } from "../helpers/verify-artifacts";

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

		expect(threshold).toBeCloseTo(0.785, 4);
	});

	test("resolves a dynamic child threshold from age at issue and document age", () => {
		const threshold = resolveFaceMatchThresholdFromDg1({
			dg1: createDg1({
				birthDateIso: "2007-04-18",
				expiryDateIso: "2027-04-19",
			}),
			now: new Date("2026-04-19T00:00:00.000Z"),
		});

		expect(threshold).toBeCloseTo(0.752, 4);
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
});
