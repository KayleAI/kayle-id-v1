import {
	ageFromDateOfBirth,
	dateFromIsoDate,
	shiftIsoDateByYears,
} from "./dg1-dates";
import { parseDg1Claims } from "./dg1-mrz";
import { DEFAULT_FACE_MATCH_THRESHOLD } from "./validation-types";

const CHILD_DOCUMENT_VALIDITY_YEARS = 5 as const;
const ADULT_DOCUMENT_VALIDITY_YEARS = 10 as const;
const CHILD_DOCUMENT_MAX_ISSUE_AGE = 16;
const ADULT_DOCUMENT_MIN_ISSUE_AGE = 16;
const MAX_YOUTH_AGE = 25;
const YOUTH_DRIFT_RANGE_YEARS = 10;
const DOCUMENT_AGE_WEIGHT = 0.14;
const YOUTH_DRIFT_WEIGHT = 0.09;

export const MIN_FACE_MATCH_THRESHOLD = 0.6875;
export const MAX_FACE_MATCH_THRESHOLD = 0.8;

type DocumentValidityYears =
	| typeof CHILD_DOCUMENT_VALIDITY_YEARS
	| typeof ADULT_DOCUMENT_VALIDITY_YEARS;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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
