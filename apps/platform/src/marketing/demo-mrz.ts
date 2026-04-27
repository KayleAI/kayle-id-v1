const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DIGIT_REGEX = /^\d$/;
const MRZ_WEIGHTS = [7, 3, 1] as const;

function normalizeMrzText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[\s-]+/g, "<")
    .replace(/'/g, "")
    .replace(/[^A-Z0-9<]/g, "<");
}

function padMrzField(value: string, length: number): string {
  return value.padEnd(length, "<").slice(0, length);
}

function getMrzCharacterValue(character: string): number {
  if (character === "<") {
    return 0;
  }

  if (DIGIT_REGEX.test(character)) {
    return Number.parseInt(character, 10);
  }

  return character.charCodeAt(0) - 55;
}

function calculateMrzCheckDigit(value: string): string {
  let total = 0;

  for (const [index, character] of [...value].entries()) {
    total += getMrzCharacterValue(character) * MRZ_WEIGHTS[index % 3];
  }

  return String(total % 10);
}

function createMrzPlaceholder(length: number): string {
  return "<".repeat(length);
}

function formatIsoDateForMrz(value: string | null | undefined): string {
  if (!(value && ISO_DATE_REGEX.test(value))) {
    return createMrzPlaceholder(6);
  }

  const [yearText, monthText, dayText] = value.split("-");
  const date = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText))
  );

  if (
    date.getUTCFullYear() !== Number(yearText) ||
    date.getUTCMonth() !== Number(monthText) - 1 ||
    date.getUTCDate() !== Number(dayText)
  ) {
    return createMrzPlaceholder(6);
  }

  return `${yearText.slice(2)}${monthText}${dayText}`;
}

function normalizeSexMarkerForMrz(value: string): string {
  if (value === "M" || value === "F") {
    return value;
  }

  return "<";
}

export function buildPassportMachineReadableZone({
  dateOfBirth,
  documentExpiryDate,
  documentNumber,
  documentTypeCode,
  familyName,
  givenNames,
  issuingCountryCode,
  mrzOptionalData,
  nationalityCode,
  sexMarker,
}: {
  dateOfBirth: string | null;
  documentExpiryDate: string | null;
  documentNumber: string | null;
  documentTypeCode: string | null;
  familyName: string | null;
  givenNames: string | null;
  issuingCountryCode: string | null;
  mrzOptionalData: string | null;
  nationalityCode: string | null;
  sexMarker: string | null;
}): readonly [string, string] {
  const birthDate = formatIsoDateForMrz(dateOfBirth);
  const expiryDate = formatIsoDateForMrz(documentExpiryDate);
  const surname = familyName ? normalizeMrzText(familyName) : "";
  const givenNameBlock = givenNames ? normalizeMrzText(givenNames) : "";

  const documentCode = padMrzField(
    normalizeMrzText(documentTypeCode ?? "P"),
    2
  );
  const issuingState = padMrzField(
    normalizeMrzText(issuingCountryCode ?? ""),
    3
  );
  const nameField = padMrzField(
    `${surname || "<"}<<${givenNameBlock || "<"}`,
    39
  );
  const passportNumber = padMrzField(normalizeMrzText(documentNumber ?? ""), 9);
  const passportNumberCheckDigit = calculateMrzCheckDigit(passportNumber);
  const nationality = padMrzField(normalizeMrzText(nationalityCode ?? ""), 3);
  const birthDateCheckDigit = calculateMrzCheckDigit(birthDate);
  const normalizedSexMarker = normalizeSexMarkerForMrz(sexMarker ?? "<");
  const expiryDateCheckDigit = calculateMrzCheckDigit(expiryDate);
  const optionalData = padMrzField(normalizeMrzText(mrzOptionalData ?? ""), 14);
  const optionalDataCheckDigit = calculateMrzCheckDigit(optionalData);
  const compositeCheckDigit = calculateMrzCheckDigit(
    [
      passportNumber,
      passportNumberCheckDigit,
      birthDate,
      birthDateCheckDigit,
      expiryDate,
      expiryDateCheckDigit,
      optionalData,
      optionalDataCheckDigit,
    ].join("")
  );

  return [
    `${documentCode}${issuingState}${nameField}`,
    `${passportNumber}${passportNumberCheckDigit}${nationality}${birthDate}${birthDateCheckDigit}${normalizedSexMarker}${expiryDate}${expiryDateCheckDigit}${optionalData}${optionalDataCheckDigit}${compositeCheckDigit}`,
  ] as const;
}
