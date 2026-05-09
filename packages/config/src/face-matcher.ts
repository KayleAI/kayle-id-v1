import { z } from "zod";

export const FACE_MATCHER_AUTH_HEADER = "x-kayle-face-matcher-auth";
export const FACE_MATCHER_DG2_FIELD = "dg2";
export const FACE_MATCHER_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const FACE_MATCHER_MAX_SELFIES = 3;
export const FACE_MATCHER_MAX_REQUEST_BYTES =
  FACE_MATCHER_MAX_IMAGE_BYTES * (FACE_MATCHER_MAX_SELFIES + 1) + 64 * 1024;
export const FACE_MATCHER_MAX_THRESHOLD = 1;
export const FACE_MATCHER_MIN_THRESHOLD = 0;
export const FACE_MATCHER_SELFIE_FIELD_PREFIX = "selfie_";
export const FACE_MATCHER_THRESHOLD_FIELD = "threshold";

export const faceMatcherResponseSchema = z.object({
  faceScore: z.number().min(0).max(1).nullable(),
  passed: z.boolean(),
  usedFallback: z.boolean(),
  reason: z.string().optional(),
});

export type FaceMatcherResponsePayload = z.infer<
  typeof faceMatcherResponseSchema
>;

export interface FaceMatcherMultipartPayload {
  dg2Image: Uint8Array;
  selfies: Uint8Array[];
  threshold?: number;
}

type MultipartEntry = Blob | string;

const selfieFieldPattern = new RegExp(
  `^${FACE_MATCHER_SELFIE_FIELD_PREFIX}(\\d+)$`
);

function blobFromBytes(bytes: Uint8Array): Blob {
  const exactBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(exactBuffer).set(bytes);

  return new Blob([exactBuffer], {
    type: "application/octet-stream",
  });
}

function parseThresholdValue(value: MultipartEntry | null): number | undefined {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    throw new Error("face_matcher_threshold_invalid");
  }

  if (
    parsed < FACE_MATCHER_MIN_THRESHOLD ||
    parsed > FACE_MATCHER_MAX_THRESHOLD
  ) {
    throw new Error("face_matcher_threshold_out_of_range");
  }

  return parsed;
}

function validateImageBytes(bytes: Uint8Array, label: string): Uint8Array {
  if (bytes.byteLength === 0) {
    throw new Error(`face_matcher_${label}_empty`);
  }

  if (bytes.byteLength > FACE_MATCHER_MAX_IMAGE_BYTES) {
    throw new Error(`face_matcher_${label}_too_large`);
  }

  return bytes;
}

async function bytesFromEntry(
  entry: MultipartEntry | null,
  label: string
): Promise<Uint8Array> {
  if (!(entry instanceof Blob)) {
    throw new Error(`face_matcher_${label}_missing`);
  }

  return validateImageBytes(new Uint8Array(await entry.arrayBuffer()), label);
}

export function createFaceMatcherRequestFormData({
  dg2Image,
  selfies,
  threshold,
}: FaceMatcherMultipartPayload): FormData {
  validateImageBytes(dg2Image, "dg2");

  if (selfies.length === 0) {
    throw new Error("face_matcher_selfies_missing");
  }

  if (selfies.length > FACE_MATCHER_MAX_SELFIES) {
    throw new Error("face_matcher_selfies_too_many");
  }

  if (typeof threshold === "number" && !Number.isFinite(threshold)) {
    throw new Error("face_matcher_threshold_invalid");
  }

  if (
    typeof threshold === "number" &&
    (threshold < FACE_MATCHER_MIN_THRESHOLD ||
      threshold > FACE_MATCHER_MAX_THRESHOLD)
  ) {
    throw new Error("face_matcher_threshold_out_of_range");
  }

  const formData = new FormData();

  formData.append(FACE_MATCHER_DG2_FIELD, blobFromBytes(dg2Image), "dg2.bin");

  for (const [index, selfie] of selfies.entries()) {
    validateImageBytes(selfie, "selfie");

    formData.append(
      `${FACE_MATCHER_SELFIE_FIELD_PREFIX}${index}`,
      blobFromBytes(selfie),
      `selfie_${index}.jpg`
    );
  }

  if (typeof threshold === "number") {
    formData.append(FACE_MATCHER_THRESHOLD_FIELD, String(threshold));
  }

  return formData;
}

export async function parseFaceMatcherRequestFormData(
  formData: FormData
): Promise<FaceMatcherMultipartPayload> {
  const dg2Image = await bytesFromEntry(
    formData.get(FACE_MATCHER_DG2_FIELD),
    "dg2"
  );
  const threshold = parseThresholdValue(
    formData.get(FACE_MATCHER_THRESHOLD_FIELD)
  );
  const selfies: Promise<{ index: number; bytes: Uint8Array }>[] = [];

  for (const [fieldName, value] of formData.entries()) {
    const match = selfieFieldPattern.exec(fieldName);

    if (!match) {
      continue;
    }

    const index = Number.parseInt(match[1] ?? "", 10);

    if (!Number.isFinite(index) || index < 0) {
      throw new Error("face_matcher_selfie_index_invalid");
    }

    if (index >= FACE_MATCHER_MAX_SELFIES) {
      throw new Error("face_matcher_selfie_index_too_large");
    }

    selfies.push(
      bytesFromEntry(value, "selfie").then((bytes) => ({
        index,
        bytes,
      }))
    );
  }

  const resolvedSelfies = await Promise.all(selfies);

  if (resolvedSelfies.length === 0) {
    throw new Error("face_matcher_selfies_missing");
  }

  if (resolvedSelfies.length > FACE_MATCHER_MAX_SELFIES) {
    throw new Error("face_matcher_selfies_too_many");
  }

  resolvedSelfies.sort((left, right) => left.index - right.index);

  return {
    dg2Image,
    selfies: resolvedSelfies.map(({ bytes }) => bytes),
    threshold,
  };
}

export function createFaceMatcherResponse(
  payload: FaceMatcherResponsePayload
): FaceMatcherResponsePayload {
  return {
    faceScore: payload.faceScore,
    passed: payload.passed,
    usedFallback: payload.usedFallback,
    reason: payload.reason,
  };
}
