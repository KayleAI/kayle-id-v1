import { buildBirthDateIso, buildExpiryDateIso } from "./dg1-dates";
import { readTlv } from "./tlv";

const DG1_ROOT_TAG = 0x61;
const MRZ_DATA_TAG = 0x5f_1f;
const TD1_LINE_LENGTH = 30;
const TD2_LINE_LENGTH = 36;
const TD3_LINE_LENGTH = 44;
const TD1_TOTAL_LENGTH = TD1_LINE_LENGTH * 3;
const TD2_TOTAL_LENGTH = TD2_LINE_LENGTH * 2;
const TD3_TOTAL_LENGTH = TD3_LINE_LENGTH * 2;

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

function readMrzTextFromTlv(dg1: Uint8Array): string | null {
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
		return null;
	}

	return null;
}

function extractMrzTextFromDg1(dg1: Uint8Array): string {
	return (
		readMrzTextFromTlv(dg1) ?? normalizeMrzText(new TextDecoder().decode(dg1))
	);
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
