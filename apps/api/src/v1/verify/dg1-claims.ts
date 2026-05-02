import { readTlv } from "./tlv";
import { DEFAULT_FACE_MATCH_THRESHOLD } from "./validation-types";

const DG1_ROOT_TAG = 0x61;
const MRZ_DATA_TAG = 0x5f_1f;
const MRZ_LINE_LENGTH = 44;
const MIN_BIRTH_YEAR_OFFSET = 130;
const MAX_EXPIRY_PAST_OFFSET = 50;
const MAX_EXPIRY_FUTURE_OFFSET = 50;
const SIX_DIGIT_DATE_REGEX = /^\d{6}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CHILD_PASSPORT_VALIDITY_YEARS = 5 as const;
const ADULT_PASSPORT_VALIDITY_YEARS = 10 as const;
const CHILD_PASSPORT_MAX_ISSUE_AGE = 16;
const ADULT_PASSPORT_MIN_ISSUE_AGE = 16;
const MAX_YOUTH_AGE = 25;
const YOUTH_DRIFT_RANGE_YEARS = 10;
const PASSPORT_AGE_WEIGHT = 0.14;
const YOUTH_DRIFT_WEIGHT = 0.09;

export const MIN_FACE_MATCH_THRESHOLD = 0.75;
export const MAX_FACE_MATCH_THRESHOLD = 0.9;

type PassportValidityYears =
	| typeof CHILD_PASSPORT_VALIDITY_YEARS
	| typeof ADULT_PASSPORT_VALIDITY_YEARS;

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
		.split("")
		.filter((character) => {
			if (character === "\n" || character === "<") {
				return true;
			}

			return (
				(character >= "A" && character <= "Z") ||
				(character >= "0" && character <= "9")
			);
		})
		.join("");

	const flattened = filtered.replaceAll("\n", "");

	if (flattened.length !== MRZ_LINE_LENGTH * 2 || !flattened.startsWith("P")) {
		throw new Error("dg1_mrz_invalid");
	}

	return `${flattened.slice(0, MRZ_LINE_LENGTH)}\n${flattened.slice(
		MRZ_LINE_LENGTH,
	)}`;
}

function extractMrzTextFromDg1(dg1: Uint8Array): string {
	try {
		return normalizeMrzText(new TextDecoder().decode(dg1));
	} catch {
		// Fall through to TLV parsing when DG1 is encoded as a data group.
	}

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
					return normalizeMrzText(new TextDecoder().decode(nestedEntry.value));
				}
				innerOffset = nestedEntry.nextOffset;
			}
		}

		offset = entry.nextOffset;
	}

	throw new Error("dg1_mrz_not_found");
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

function inferPassportValidityYears({
	birthDateIso,
	expiryDateIso,
}: {
	birthDateIso: string;
	expiryDateIso: string;
}): PassportValidityYears | null {
	const adultIssueAge = ageFromDateOfBirth(
		birthDateIso,
		dateFromIsoDate(
			shiftIsoDateByYears(expiryDateIso, -ADULT_PASSPORT_VALIDITY_YEARS),
		),
	);
	const childIssueAge = ageFromDateOfBirth(
		birthDateIso,
		dateFromIsoDate(
			shiftIsoDateByYears(expiryDateIso, -CHILD_PASSPORT_VALIDITY_YEARS),
		),
	);
	const adultPassportPossible = adultIssueAge >= ADULT_PASSPORT_MIN_ISSUE_AGE;
	const childPassportPossible = childIssueAge < CHILD_PASSPORT_MAX_ISSUE_AGE;

	if (adultPassportPossible === childPassportPossible) {
		return null;
	}

	return adultPassportPossible
		? ADULT_PASSPORT_VALIDITY_YEARS
		: CHILD_PASSPORT_VALIDITY_YEARS;
}

function resolvePassportAgeFraction({
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

export function parseTd3MrzClaims(dg1: Uint8Array, now: Date): Dg1Claims {
	const [lineOne, lineTwo] = extractMrzTextFromDg1(dg1).split("\n");

	if (
		!(
			lineOne &&
			lineTwo &&
			lineOne.length === MRZ_LINE_LENGTH &&
			lineTwo.length === MRZ_LINE_LENGTH &&
			lineOne.startsWith("P")
		)
	) {
		throw new Error("dg1_td3_invalid");
	}

	const { givenNames, surname } = parseNames(sliceText(lineOne, 5, 44));
	const birthYearMax = now.getUTCFullYear();
	const expiryYear = now.getUTCFullYear();
	const sex = mrzChar(lineTwo, 20);

	return {
		birthDateIso: expandMrzDateWithinRange({
			value: sliceText(lineTwo, 13, 19),
			minYear: birthYearMax - MIN_BIRTH_YEAR_OFFSET,
			maxYear: birthYearMax,
		}),
		documentNumber: unfill(sliceText(lineTwo, 0, 9)),
		documentType: unfill(sliceText(lineOne, 0, 2)),
		expiryDateIso: expandMrzDateWithinRange({
			value: sliceText(lineTwo, 21, 27),
			minYear: expiryYear - MAX_EXPIRY_PAST_OFFSET,
			maxYear: expiryYear + MAX_EXPIRY_FUTURE_OFFSET,
		}),
		givenNames,
		issuingCountry: unfill(sliceText(lineOne, 2, 5)),
		nationality: unfill(sliceText(lineTwo, 10, 13)),
		optionalData: unfill(sliceText(lineTwo, 28, 42)),
		sex: sex === "<" ? "X" : sex,
		surname,
	};
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
	const validityYears = inferPassportValidityYears({
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
	const normalizedPassportAge = resolvePassportAgeFraction({
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
			PASSPORT_AGE_WEIGHT * normalizedPassportAge -
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
	const claims = parseTd3MrzClaims(dg1, now);

	return resolveFaceMatchThreshold({
		birthDateIso: claims.birthDateIso,
		expiryDateIso: claims.expiryDateIso,
		now,
	});
}
