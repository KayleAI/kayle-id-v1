import { readTlv } from "./tlv";
import { DEFAULT_FACE_MATCH_THRESHOLD } from "./validation-types";

const DG1_ROOT_TAG = 0x61;
const MRZ_DATA_TAG = 0x5f_1f;
const TD1_LINE_LENGTH = 30;
const TD2_LINE_LENGTH = 36;
const TD3_LINE_LENGTH = 44;
const TD1_TOTAL_LENGTH = TD1_LINE_LENGTH * 3;
const TD2_TOTAL_LENGTH = TD2_LINE_LENGTH * 2;
const TD3_TOTAL_LENGTH = TD3_LINE_LENGTH * 2;
const MIN_BIRTH_YEAR_OFFSET = 130;
const MAX_EXPIRY_PAST_OFFSET = 50;
const MAX_EXPIRY_FUTURE_OFFSET = 50;
const SIX_DIGIT_DATE_REGEX = /^\d{6}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CHILD_DOCUMENT_VALIDITY_YEARS = 5 as const;
const ADULT_DOCUMENT_VALIDITY_YEARS = 10 as const;
const CHILD_DOCUMENT_MAX_ISSUE_AGE = 16;
const ADULT_DOCUMENT_MIN_ISSUE_AGE = 16;
const MAX_YOUTH_AGE = 25;
const YOUTH_DRIFT_RANGE_YEARS = 10;
const DOCUMENT_AGE_WEIGHT = 0.14;
const YOUTH_DRIFT_WEIGHT = 0.09;

// Threshold window slides between MIN and MAX based on document age +
// youth drift. Raw cosine: MAX=0.80→0.60 (strict, fresh adult docs);
// MIN=0.6875→0.375 (floor — above the InsightFace published
// same-person threshold of ~0.28-0.30 but permissive enough to absorb
// real-world ageing on aged child docs).
export const MIN_FACE_MATCH_THRESHOLD = 0.6875;
export const MAX_FACE_MATCH_THRESHOLD = 0.8;

type DocumentValidityYears =
	| typeof CHILD_DOCUMENT_VALIDITY_YEARS
	| typeof ADULT_DOCUMENT_VALIDITY_YEARS;

type MrzFormat = "td1" | "td2" | "td3";

type DetectedMrz = {
	format: MrzFormat;
	lines: string[];
};

export type Dg1Claims = {
	birthDateIso: string;
	documentNumber: string;
	documentType: string;
	expiryDateIso: string;
	givenNames: string;
	issuingCountry: string;
	nationality: string;
	optionalData: string;
	sex: string;
	surname: string;
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizeMrzText(raw: string): string {
	const filtered = raw
		.toUpperCase()
		.replaceAll(" ", "")
		.replaceAll("\r", "")
		.replaceAll("\n", "")
		.split("")
		.filter((character) => {
			if (character === "<") {
				return true;
			}

			return (
				(character >= "A" && character <= "Z") ||
				(character >= "0" && character <= "9")
			);
		})
		.join("");

	if (
		filtered.length !== TD1_TOTAL_LENGTH &&
		filtered.length !== TD2_TOTAL_LENGTH &&
		filtered.length !== TD3_TOTAL_LENGTH
	) {
		throw new Error("dg1_mrz_invalid");
	}

	return filtered;
}

function extractMrzTextFromDg1(dg1: Uint8Array): string {
	try {
		let offset = 0;

		while (offset < dg1.length) {
			const entry = readTlv(dg1, offset);

			if (entry.tag === MRZ_DATA_TAG) {
				return normalizeMrzText(new TextDecoder().decode(entry.value));
			}

			if (entry.tag === DG1_ROOT_TAG) {
				let innerOffset = 0;

				while (innerOffset < entry.value.length) {
					const nestedEntry = readTlv(entry.value, innerOffset);
					if (nestedEntry.tag === MRZ_DATA_TAG) {
						return normalizeMrzText(
							new TextDecoder().decode(nestedEntry.value),
						);
					}
					innerOffset = nestedEntry.nextOffset;
				}
			}

			offset = entry.nextOffset;
		}
	} catch {
		// Fall through to plain-text decode when DG1 isn't a well-formed TLV.
	}

	return normalizeMrzText(new TextDecoder().decode(dg1));
}

function detectMrzFormat(rawMrz: string): DetectedMrz | null {
	if (rawMrz.length === TD3_TOTAL_LENGTH) {
		return {
			format: "td3",
			lines: [rawMrz.slice(0, TD3_LINE_LENGTH), rawMrz.slice(TD3_LINE_LENGTH)],
		};
	}

	if (rawMrz.length === TD2_TOTAL_LENGTH) {
		return {
			format: "td2",
			lines: [rawMrz.slice(0, TD2_LINE_LENGTH), rawMrz.slice(TD2_LINE_LENGTH)],
		};
	}

	if (rawMrz.length === TD1_TOTAL_LENGTH) {
		return {
			format: "td1",
			lines: [
				rawMrz.slice(0, TD1_LINE_LENGTH),
				rawMrz.slice(TD1_LINE_LENGTH, TD1_LINE_LENGTH * 2),
				rawMrz.slice(TD1_LINE_LENGTH * 2),
			],
		};
	}

	return null;
}

function sliceText(value: string, start: number, end: number): string {
	return value.slice(start, end);
}

function mrzChar(value: string, index: number): string {
	return value[index] ?? "";
}

function unfill(value: string): string {
	return value.replaceAll("<", "").trim();
}

function parseNames(value: string): {
	givenNames: string;
	surname: string;
} {
	const raw = value.replaceAll("<<", "|");
	const pieces = raw.split("|");
	const surname = unfill((pieces[0] ?? "").replaceAll("<", " ")).trim();
	const givenNames = unfill(
		pieces.slice(1).join(" ").replaceAll("<", " "),
	).trim();

	return {
		givenNames,
		surname,
	};
}

function expandMrzDateWithinRange({
	maxYear,
	minYear,
	value,
}: {
	maxYear: number;
	minYear: number;
	value: string;
}): string {
	if (!SIX_DIGIT_DATE_REGEX.test(value)) {
		throw new Error("mrz_date_invalid");
	}

	const yearSuffix = Number.parseInt(value.slice(0, 2), 10);
	const month = Number.parseInt(value.slice(2, 4), 10);
	const day = Number.parseInt(value.slice(4, 6), 10);
	const baseCentury = Math.floor(maxYear / 100) * 100;
	const candidateYears = new Set<number>();

	for (const offset of [-200, -100, 0, 100]) {
		candidateYears.add(baseCentury + offset + yearSuffix);
	}

	const validYears = [...candidateYears]
		.filter(
			(candidateYear) => candidateYear >= minYear && candidateYear <= maxYear,
		)
		.sort((left, right) => right - left);
	const resolvedYear = validYears[0];

	if (!resolvedYear || month < 1 || month > 12 || day < 1 || day > 31) {
		throw new Error("mrz_date_invalid");
	}

	return `${resolvedYear.toString().padStart(4, "0")}-${value.slice(
		2,
		4,
	)}-${value.slice(4, 6)}`;
}

function parseIsoDate(dateIso: string): {
	day: number;
	month: number;
	year: number;
} {
	if (!ISO_DATE_REGEX.test(dateIso)) {
		throw new Error("iso_date_invalid");
	}

	const year = Number.parseInt(dateIso.slice(0, 4), 10);
	const month = Number.parseInt(dateIso.slice(5, 7), 10);
	const day = Number.parseInt(dateIso.slice(8, 10), 10);
	const maxDay = daysInMonth(year, month);

	if (month < 1 || month > 12 || day < 1 || day > maxDay) {
		throw new Error("iso_date_invalid");
	}

	return {
		day,
		month,
		year,
	};
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateFromIsoDate(dateIso: string): Date {
	const { year, month, day } = parseIsoDate(dateIso);

	return new Date(Date.UTC(year, month - 1, day));
}

function shiftIsoDateByYears(dateIso: string, yearDelta: number): string {
	const { year, month, day } = parseIsoDate(dateIso);
	const targetYear = year + yearDelta;
	const targetDay = Math.min(day, daysInMonth(targetYear, month));

	return `${targetYear.toString().padStart(4, "0")}-${month
		.toString()
		.padStart(2, "0")}-${targetDay.toString().padStart(2, "0")}`;
}

function inferDocumentValidityYears({
	birthDateIso,
	expiryDateIso,
}: {
	birthDateIso: string;
	expiryDateIso: string;
}): DocumentValidityYears | null {
	const adultIssueAge = ageFromDateOfBirth(
		birthDateIso,
		dateFromIsoDate(
			shiftIsoDateByYears(expiryDateIso, -ADULT_DOCUMENT_VALIDITY_YEARS),
		),
	);
	const childIssueAge = ageFromDateOfBirth(
		birthDateIso,
		dateFromIsoDate(
			shiftIsoDateByYears(expiryDateIso, -CHILD_DOCUMENT_VALIDITY_YEARS),
		),
	);
	const adultIssuancePossible = adultIssueAge >= ADULT_DOCUMENT_MIN_ISSUE_AGE;
	const childIssuancePossible = childIssueAge < CHILD_DOCUMENT_MAX_ISSUE_AGE;

	if (adultIssuancePossible === childIssuancePossible) {
		return null;
	}

	return adultIssuancePossible
		? ADULT_DOCUMENT_VALIDITY_YEARS
		: CHILD_DOCUMENT_VALIDITY_YEARS;
}

function resolveDocumentAgeFraction({
	expiryDateIso,
	issueDateIso,
	now,
}: {
	expiryDateIso: string;
	issueDateIso: string;
	now: Date;
}): number {
	const issueTime = dateFromIsoDate(issueDateIso).getTime();
	const expiryTime = dateFromIsoDate(expiryDateIso).getTime();
	const validityDuration = expiryTime - issueTime;

	if (validityDuration <= 0) {
		return 0;
	}

	return clamp((now.getTime() - issueTime) / validityDuration, 0, 1);
}

function buildBirthDateIso(value: string, now: Date): string {
	const birthYearMax = now.getUTCFullYear();

	return expandMrzDateWithinRange({
		value,
		minYear: birthYearMax - MIN_BIRTH_YEAR_OFFSET,
		maxYear: birthYearMax,
	});
}

function buildExpiryDateIso(value: string, now: Date): string {
	const expiryYear = now.getUTCFullYear();

	return expandMrzDateWithinRange({
		value,
		minYear: expiryYear - MAX_EXPIRY_PAST_OFFSET,
		maxYear: expiryYear + MAX_EXPIRY_FUTURE_OFFSET,
	});
}

function normalizeSex(value: string): string {
	return value === "<" ? "X" : value;
}

function parseTd3Lines(lines: string[], now: Date): Dg1Claims {
	const lineOne = lines[0] ?? "";
	const lineTwo = lines[1] ?? "";
	const { givenNames, surname } = parseNames(sliceText(lineOne, 5, 44));

	return {
		birthDateIso: buildBirthDateIso(sliceText(lineTwo, 13, 19), now),
		documentNumber: unfill(sliceText(lineTwo, 0, 9)),
		documentType: unfill(sliceText(lineOne, 0, 2)),
		expiryDateIso: buildExpiryDateIso(sliceText(lineTwo, 21, 27), now),
		givenNames,
		issuingCountry: unfill(sliceText(lineOne, 2, 5)),
		nationality: unfill(sliceText(lineTwo, 10, 13)),
		optionalData: unfill(sliceText(lineTwo, 28, 42)),
		sex: normalizeSex(mrzChar(lineTwo, 20)),
		surname,
	};
}

function parseTd2Lines(lines: string[], now: Date): Dg1Claims {
	const lineOne = lines[0] ?? "";
	const lineTwo = lines[1] ?? "";
	const { givenNames, surname } = parseNames(sliceText(lineOne, 5, 36));

	return {
		birthDateIso: buildBirthDateIso(sliceText(lineTwo, 13, 19), now),
		documentNumber: unfill(sliceText(lineTwo, 0, 9)),
		documentType: unfill(sliceText(lineOne, 0, 2)),
		expiryDateIso: buildExpiryDateIso(sliceText(lineTwo, 21, 27), now),
		givenNames,
		issuingCountry: unfill(sliceText(lineOne, 2, 5)),
		nationality: unfill(sliceText(lineTwo, 10, 13)),
		optionalData: unfill(sliceText(lineTwo, 28, 35)),
		sex: normalizeSex(mrzChar(lineTwo, 20)),
		surname,
	};
}

function parseTd1Lines(lines: string[], now: Date): Dg1Claims {
	const lineOne = lines[0] ?? "";
	const lineTwo = lines[1] ?? "";
	const lineThree = lines[2] ?? "";
	const { givenNames, surname } = parseNames(lineThree);
	const optionalData1 = sliceText(lineOne, 15, 30);
	const optionalData2 = sliceText(lineTwo, 18, 29);

	return {
		birthDateIso: buildBirthDateIso(sliceText(lineTwo, 0, 6), now),
		documentNumber: unfill(sliceText(lineOne, 5, 14)),
		documentType: unfill(sliceText(lineOne, 0, 2)),
		expiryDateIso: buildExpiryDateIso(sliceText(lineTwo, 8, 14), now),
		givenNames,
		issuingCountry: unfill(sliceText(lineOne, 2, 5)),
		nationality: unfill(sliceText(lineTwo, 15, 18)),
		optionalData: unfill(optionalData1 + optionalData2),
		sex: normalizeSex(mrzChar(lineTwo, 7)),
		surname,
	};
}

export function parseDg1Claims(dg1: Uint8Array, now: Date): Dg1Claims {
	const rawMrz = extractMrzTextFromDg1(dg1);
	const detected = detectMrzFormat(rawMrz);

	if (!detected) {
		throw new Error("dg1_mrz_invalid");
	}

	switch (detected.format) {
		case "td1":
			return parseTd1Lines(detected.lines, now);
		case "td2":
			return parseTd2Lines(detected.lines, now);
		default:
			return parseTd3Lines(detected.lines, now);
	}
}

export function parseTd3MrzClaims(dg1: Uint8Array, now: Date): Dg1Claims {
	const claims = parseDg1Claims(dg1, now);

	if (!claims.documentType.startsWith("P")) {
		throw new Error("dg1_td3_invalid");
	}

	return claims;
}

export function ageFromDateOfBirth(
	dateOfBirthIso: string,
	referenceDate: Date,
): number {
	const { year, month, day } = parseIsoDate(dateOfBirthIso);
	let age = referenceDate.getUTCFullYear() - year;
	const monthDelta = referenceDate.getUTCMonth() + 1 - month;
	const dayDelta = referenceDate.getUTCDate() - day;

	if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
		age -= 1;
	}

	return age;
}

export function resolveFaceMatchThreshold({
	birthDateIso,
	expiryDateIso,
	now,
}: {
	birthDateIso: string;
	expiryDateIso: string;
	now: Date;
}): number {
	const validityYears = inferDocumentValidityYears({
		birthDateIso,
		expiryDateIso,
	});

	if (!validityYears) {
		return DEFAULT_FACE_MATCH_THRESHOLD;
	}

	const issueDateIso = shiftIsoDateByYears(expiryDateIso, -validityYears);
	const currentAgeYears = ageFromDateOfBirth(birthDateIso, now);
	const issueAgeYears = ageFromDateOfBirth(
		birthDateIso,
		dateFromIsoDate(issueDateIso),
	);
	const normalizedDocumentAge = resolveDocumentAgeFraction({
		expiryDateIso,
		issueDateIso,
		now,
	});
	const normalizedYouthDrift = clamp(
		(Math.min(currentAgeYears, MAX_YOUTH_AGE) -
			Math.min(issueAgeYears, MAX_YOUTH_AGE)) /
			YOUTH_DRIFT_RANGE_YEARS,
		0,
		1,
	);

	return clamp(
		MAX_FACE_MATCH_THRESHOLD -
			DOCUMENT_AGE_WEIGHT * normalizedDocumentAge -
			YOUTH_DRIFT_WEIGHT * normalizedYouthDrift,
		MIN_FACE_MATCH_THRESHOLD,
		MAX_FACE_MATCH_THRESHOLD,
	);
}

export function resolveFaceMatchThresholdFromDg1({
	dg1,
	now,
}: {
	dg1: Uint8Array;
	now: Date;
}): number {
	const claims = parseDg1Claims(dg1, now);

	if (!claims.documentType.startsWith("P")) {
		return DEFAULT_FACE_MATCH_THRESHOLD;
	}

	return resolveFaceMatchThreshold({
		birthDateIso: claims.birthDateIso,
		expiryDateIso: claims.expiryDateIso,
		now,
	});
}
