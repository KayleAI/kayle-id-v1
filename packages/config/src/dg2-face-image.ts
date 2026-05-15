export type SupportedImageFormat = "jpeg" | "jpeg2000";

export interface Dg2FaceImage {
  imageData: Uint8Array;
  imageFormat: SupportedImageFormat;
  imageHeight: number;
  imageWidth: number;
}

const FAC_HEADER = [0x46, 0x41, 0x43, 0x00] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const JPEG_2000_FILE_SIGNATURE = [
  0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
] as const;
const JPEG_2000_CODESTREAM_SIGNATURE = [0xff, 0x4f, 0xff, 0x51] as const;
const FEATURE_POINT_SIZE = 8;
const ONE_BYTE = 0x1_00;
const MULTI_BYTE_TAG_MASK = 0x20;
const MULTI_BYTE_TAG_SENTINEL = 0x1f;
const CONTINUATION_BYTE_MIN = 0x80;
const SHORT_LENGTH_MAX = 0x80;
const DG2_FILE_TAG = 0x75;
const DG2_ROOT_TAG = 0x7f_61;
const DG2_BIOMETRIC_GROUP_TAG = 0x7f_60;
const DG2_BIOMETRIC_DATA_TAG = 0x7f_2e;
const DG2_BIOMETRIC_DATA_ALT_TAG = 0x5f_2e;

interface TlvValue {
  nextOffset: number;
  tag: number;
  value: Uint8Array;
}

function startsWithBytes(
  bytes: Uint8Array,
  prefix: readonly number[]
): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) {
      return false;
    }
  }

  return true;
}

function byteAt(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new Error("dg2_out_of_bounds");
  }
  return value;
}

function readUint(bytes: Uint8Array, offset: number, length: number): number {
  if (offset < 0 || length <= 0 || offset + length > bytes.length) {
    throw new Error("dg2_out_of_bounds");
  }

  let value = 0;

  for (let index = 0; index < length; index += 1) {
    value = value * ONE_BYTE + byteAt(bytes, offset + index);
  }

  return value;
}

function readTlvTag(
  bytes: Uint8Array,
  startOffset: number
): {
  tag: number;
  nextOffset: number;
} {
  if (startOffset >= bytes.length) {
    throw new Error("tlv_out_of_bounds");
  }

  let offset = startOffset;
  let tag = byteAt(bytes, offset);
  offset += 1;

  if (tag % MULTI_BYTE_TAG_MASK !== MULTI_BYTE_TAG_SENTINEL) {
    return {
      tag,
      nextOffset: offset,
    };
  }

  let nextTagByte = 0;

  do {
    if (offset >= bytes.length) {
      throw new Error("tlv_tag_truncated");
    }

    nextTagByte = byteAt(bytes, offset);
    tag = tag * ONE_BYTE + nextTagByte;
    offset += 1;
  } while (nextTagByte >= CONTINUATION_BYTE_MIN);

  return {
    tag,
    nextOffset: offset,
  };
}

function readTlvLength(
  bytes: Uint8Array,
  startOffset: number
): {
  length: number;
  nextOffset: number;
} {
  if (startOffset >= bytes.length) {
    throw new Error("tlv_length_truncated");
  }

  const firstLengthByte = byteAt(bytes, startOffset);
  let offset = startOffset + 1;

  if (firstLengthByte < SHORT_LENGTH_MAX) {
    return {
      length: firstLengthByte,
      nextOffset: offset,
    };
  }

  const lengthByteCount = firstLengthByte % SHORT_LENGTH_MAX;

  if (
    lengthByteCount === 0 ||
    lengthByteCount > 4 ||
    offset + lengthByteCount > bytes.length
  ) {
    throw new Error("tlv_length_invalid");
  }

  let length = 0;

  for (let index = 0; index < lengthByteCount; index += 1) {
    length = length * ONE_BYTE + byteAt(bytes, offset + index);
  }

  offset += lengthByteCount;

  return {
    length,
    nextOffset: offset,
  };
}

function readTlv(bytes: Uint8Array, startOffset: number): TlvValue {
  const { tag, nextOffset: valueOffset } = readTlvTag(bytes, startOffset);
  const { length, nextOffset } = readTlvLength(bytes, valueOffset);

  if (nextOffset + length > bytes.length) {
    throw new Error("tlv_value_truncated");
  }

  return {
    tag,
    value: bytes.slice(nextOffset, nextOffset + length),
    nextOffset: nextOffset + length,
  };
}

function parseIso197945FaceImage(data: Uint8Array): Dg2FaceImage {
  if (!startsWithBytes(data, FAC_HEADER)) {
    throw new Error("dg2_fac_header_invalid");
  }

  let offset = FAC_HEADER.length;

  offset += 4;
  offset += 4;
  offset += 2;

  offset += 4;
  const featurePointCount = readUint(data, offset, 2);
  offset += 2;
  offset += 1;
  offset += 1;
  offset += 1;
  offset += 3;
  offset += 2;
  offset += 3;
  offset += 3;
  offset += featurePointCount * FEATURE_POINT_SIZE;

  offset += 1;
  offset += 1;
  const imageWidth = readUint(data, offset, 2);
  offset += 2;
  const imageHeight = readUint(data, offset, 2);
  offset += 2;
  offset += 1;
  offset += 1;
  offset += 2;
  offset += 2;

  if (offset >= data.length) {
    throw new Error("dg2_image_missing");
  }

  const imageData = data.slice(offset);

  if (startsWithBytes(imageData, JPEG_SIGNATURE)) {
    return {
      imageData,
      imageFormat: "jpeg",
      imageHeight,
      imageWidth,
    };
  }

  if (
    startsWithBytes(imageData, JPEG_2000_FILE_SIGNATURE) ||
    startsWithBytes(imageData, JPEG_2000_CODESTREAM_SIGNATURE)
  ) {
    return {
      imageData,
      imageFormat: "jpeg2000",
      imageHeight,
      imageWidth,
    };
  }

  throw new Error("dg2_image_format_unsupported");
}

export function extractDg2FaceImage(dg2: Uint8Array): Dg2FaceImage {
  const outer = readTlv(dg2, 0);
  const root = outer.tag === DG2_FILE_TAG ? readTlv(outer.value, 0) : outer;

  if (root.tag !== DG2_ROOT_TAG) {
    throw new Error("dg2_root_tag_invalid");
  }

  let offset = 0;
  const numberOfInstances = readTlv(root.value, offset);
  if (numberOfInstances.tag !== 0x02) {
    throw new Error("dg2_instance_count_missing");
  }

  offset = numberOfInstances.nextOffset;
  const biometricGroup = readTlv(root.value, offset);
  if (biometricGroup.tag !== DG2_BIOMETRIC_GROUP_TAG) {
    throw new Error("dg2_biometric_group_missing");
  }

  let groupOffset = 0;

  while (groupOffset < biometricGroup.value.length) {
    const child = readTlv(biometricGroup.value, groupOffset);

    if (
      child.tag === DG2_BIOMETRIC_DATA_ALT_TAG ||
      child.tag === DG2_BIOMETRIC_DATA_TAG
    ) {
      return parseIso197945FaceImage(child.value);
    }

    groupOffset = child.nextOffset;
  }

  throw new Error("dg2_biometric_data_missing");
}
