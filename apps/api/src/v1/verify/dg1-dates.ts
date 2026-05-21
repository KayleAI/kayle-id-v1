const MIN_BIRTH_YEAR_OFFSET = 130;
const MAX_EXPIRY_PAST_OFFSET = 50;
const MAX_EXPIRY_FUTURE_OFFSET = 50;
const SIX_DIGIT_DATE_REGEX = /^\d{6}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

export function dateFromIsoDate(dateIso: string): Date {
	const { year, month, day } = parseIsoDate(dateIso);

	return new Date(Date.UTC(year, month - 1, day));
}

export function shiftIsoDateByYears(
	dateIso: string,
	yearDelta: number,
): string {
	const { year, month, day } = parseIsoDate(dateIso);
	const targetYear = year + yearDelta;
	const targetDay = Math.min(day, daysInMonth(targetYear, month));

	return `${targetYear.toString().padStart(4, "0")}-${month
		.toString()
		.padStart(2, "0")}-${targetDay.toString().padStart(2, "0")}`;
}

export function buildBirthDateIso(value: string, now: Date): string {
	const birthYearMax = now.getUTCFullYear();

	return expandMrzDateWithinRange({
		value,
		minYear: birthYearMax - MIN_BIRTH_YEAR_OFFSET,
		maxYear: birthYearMax,
	});
}

export function buildExpiryDateIso(value: string, now: Date): string {
	const expiryYear = now.getUTCFullYear();

	return expandMrzDateWithinRange({
		value,
		minYear: expiryYear - MAX_EXPIRY_PAST_OFFSET,
		maxYear: expiryYear + MAX_EXPIRY_FUTURE_OFFSET,
	});
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
