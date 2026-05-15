// Minimal DG2 wrapper for contributor convenience: take a face JPEG or
// JPEG2000 and emit a valid DG2 byte structure the verifier worker can
// parse with `extractDg2FaceImage`. Mirrors apps/api/tests/helpers/
// verify-artifacts.ts:createDg2Artifact (kept inline here so the debug
// app doesn't pull node-only test deps into the browser bundle).

const ONE_BYTE = 0x1_00;
const SHORT_LENGTH_MAX = 0x80;
const LONG_LENGTH_PREFIX = 0x80;

const FAC_HEADER = [0x46, 0x41, 0x43, 0x00] as const;
const ISO_19794_5_VERSION = 0x30_31_30_00;
const DG2_FILE_TAG = 0x75;
const DG2_ROOT_TAG = 0x7f_61;
const DG2_BIOMETRIC_GROUP_TAG = 0x7f_60;
const DG2_BIOMETRIC_DATA_TAG = 0x5f_2e;

export type Dg2WrapImageFormat = "jpeg" | "jpeg2000";

function uintBytes(value: number, length: number): number[] {
	const bytes = new Array<number>(length);
	let remaining = value;
	for (let index = length - 1; index >= 0; index -= 1) {
		bytes[index] = remaining % ONE_BYTE;
		remaining = Math.floor(remaining / ONE_BYTE);
	}
	return bytes;
}

function tagBytes(tag: number): number[] {
	const hex = tag.toString(16).padStart(tag > 0xff ? 4 : 2, "0");
	const bytes: number[] = [];
	for (let index = 0; index < hex.length; index += 2) {
		bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
	}
	return bytes;
}

function lengthBytes(length: number): number[] {
	if (length < SHORT_LENGTH_MAX) {
		return [length];
	}
	const encoded: number[] = [];
	let remaining = length;
	while (remaining > 0) {
		encoded.unshift(remaining % ONE_BYTE);
		remaining = Math.floor(remaining / ONE_BYTE);
	}
	return [LONG_LENGTH_PREFIX + encoded.length, ...encoded];
}

function encodeTlv(tag: number, value: Uint8Array): Uint8Array {
	return Uint8Array.from([
		...tagBytes(tag),
		...lengthBytes(value.length),
		...value,
	]);
}

export function wrapImageAsDg2({
	imageBytes,
	imageFormat,
	wrapWithEfTag = true,
}: {
	imageBytes: Uint8Array;
	imageFormat: Dg2WrapImageFormat;
	wrapWithEfTag?: boolean;
}): Uint8Array {
	const facialRecordLength = 42 + imageBytes.length;
	const iso197945Record = Uint8Array.from([
		...FAC_HEADER,
		...uintBytes(ISO_19794_5_VERSION, 4),
		...uintBytes(facialRecordLength, 4),
		...uintBytes(1, 2),
		...uintBytes(facialRecordLength, 4),
		...uintBytes(0, 2),
		0x00,
		0x00,
		0x00,
		...uintBytes(0, 3),
		...uintBytes(0, 2),
		...uintBytes(0, 3),
		...uintBytes(0, 3),
		0x00,
		imageFormat === "jpeg" ? 0x00 : 0x01,
		// Width/height baked at 0; YuNet doesn't read them — it operates on
		// the decoded image. The verifier worker only uses the trailing
		// image bytes, so these dimensions are cosmetic in this context.
		...uintBytes(0, 2),
		...uintBytes(0, 2),
		0x01,
		0x02,
		...uintBytes(0, 2),
		...uintBytes(100, 2),
		...imageBytes,
	]);

	const biometricData = encodeTlv(DG2_BIOMETRIC_DATA_TAG, iso197945Record);
	const biometricHeader = encodeTlv(0xa1, new Uint8Array());
	const biometricGroup = encodeTlv(
		DG2_BIOMETRIC_GROUP_TAG,
		Uint8Array.from([...biometricHeader, ...biometricData]),
	);
	const biometricRoot = encodeTlv(
		DG2_ROOT_TAG,
		Uint8Array.from([...encodeTlv(0x02, Uint8Array.of(1)), ...biometricGroup]),
	);
	return wrapWithEfTag ? encodeTlv(DG2_FILE_TAG, biometricRoot) : biometricRoot;
}

export function detectImageFormat(
	bytes: Uint8Array,
): Dg2WrapImageFormat | null {
	// JPEG: FF D8 FF
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "jpeg";
	}
	// JPEG 2000 codestream: FF 4F FF 51
	if (
		bytes.length >= 4 &&
		bytes[0] === 0xff &&
		bytes[1] === 0x4f &&
		bytes[2] === 0xff &&
		bytes[3] === 0x51
	) {
		return "jpeg2000";
	}
	// JPEG 2000 box-based (.jp2): 00 00 00 0C 6A 50 20 20
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x00 &&
		bytes[1] === 0x00 &&
		bytes[2] === 0x00 &&
		bytes[3] === 0x0c &&
		bytes[4] === 0x6a &&
		bytes[5] === 0x50 &&
		bytes[6] === 0x20 &&
		bytes[7] === 0x20
	) {
		return "jpeg2000";
	}
	return null;
}
