import { z } from "zod";

export const BIOMETRIC_VERIFIER_AUTH_HEADER = "x-kayle-biometric-verifier-auth";
export const BIOMETRIC_VERIFIER_DG2_FIELD = "dg2";
export const BIOMETRIC_VERIFIER_VIDEO_FIELD = "video";
export const BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD = "poseSequence";
export const BIOMETRIC_VERIFIER_CHALLENGE_NONCE_FIELD = "challengeNonce";
export const BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD =
  "faceMatchThreshold";

export const BIOMETRIC_VERIFIER_MAX_DG2_BYTES = 4 * 1024 * 1024;
export const BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES = 16 * 1024 * 1024;
// dg2 + video + form/multipart overhead headroom.
export const BIOMETRIC_VERIFIER_MAX_REQUEST_BYTES =
  BIOMETRIC_VERIFIER_MAX_DG2_BYTES +
  BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES +
  256 * 1024;
export const BIOMETRIC_VERIFIER_MAX_THRESHOLD = 1;
export const BIOMETRIC_VERIFIER_MIN_THRESHOLD = 0;

export const LIVENESS_POSE_VALUES = ["center", "left", "right"] as const;
export type LivenessPoseValue = (typeof LIVENESS_POSE_VALUES)[number];

const livenessPoseSchema = z.enum(LIVENESS_POSE_VALUES);

export const biometricVerifierResponseSchema = z.object({
  livenessPassed: z.boolean(),
  livenessScore: z.number().min(0).max(1).nullable(),
  faceMatchPassed: z.boolean(),
  faceMatchScore: z.number().min(0).max(1).nullable(),
  usedFallback: z.boolean(),
  // The container emits `null` on the happy path (face match passed, no
  // reason to report). `.nullish()` accepts both `null` and `undefined`
  // so we don't reject otherwise-valid container responses.
  reason: z.string().nullish(),
});

export type BiometricVerifierResponsePayload = z.infer<
  typeof biometricVerifierResponseSchema
>;

export interface BiometricVerifierMultipartPayload {
  challengeNonce?: Uint8Array;
  dg2Image: Uint8Array;
  faceMatchThreshold?: number;
  /**
   * Optional movement hint. v2 of the liveness flow accepts a left+right
   * head turn in either order, so the API no longer issues a strict pose
   * sequence — but a future tighter contract can re-introduce one. When
   * omitted, the container falls back to the default left+right coverage
   * check.
   */
  poseSequence?: LivenessPoseValue[];
  video: Uint8Array;
}

type MultipartEntry = Blob | string;

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
    throw new Error("biometric_verifier_threshold_invalid");
  }

  if (
    parsed < BIOMETRIC_VERIFIER_MIN_THRESHOLD ||
    parsed > BIOMETRIC_VERIFIER_MAX_THRESHOLD
  ) {
    throw new Error("biometric_verifier_threshold_out_of_range");
  }

  return parsed;
}

function parsePoseSequence(
  value: MultipartEntry | null
): LivenessPoseValue[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("biometric_verifier_pose_sequence_invalid");
  }

  const validated = z.array(livenessPoseSchema).safeParse(parsed);
  if (!validated.success) {
    throw new Error("biometric_verifier_pose_sequence_invalid");
  }

  return validated.data.length > 0 ? validated.data : undefined;
}

function validateDg2Bytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength === 0) {
    throw new Error("biometric_verifier_dg2_empty");
  }

  if (bytes.byteLength > BIOMETRIC_VERIFIER_MAX_DG2_BYTES) {
    throw new Error("biometric_verifier_dg2_too_large");
  }

  return bytes;
}

function validateVideoBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength === 0) {
    throw new Error("biometric_verifier_video_empty");
  }

  if (bytes.byteLength > BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES) {
    throw new Error("biometric_verifier_video_too_large");
  }

  return bytes;
}

async function bytesFromEntry(
  entry: MultipartEntry | null,
  label: string,
  maxBytes: number
): Promise<Uint8Array> {
  if (!(entry instanceof Blob)) {
    throw new Error(`biometric_verifier_${label}_missing`);
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());

  if (bytes.byteLength === 0) {
    throw new Error(`biometric_verifier_${label}_empty`);
  }

  if (bytes.byteLength > maxBytes) {
    throw new Error(`biometric_verifier_${label}_too_large`);
  }

  return bytes;
}

export function createBiometricVerifierRequestFormData({
  dg2Image,
  video,
  poseSequence,
  challengeNonce,
  faceMatchThreshold,
}: BiometricVerifierMultipartPayload): FormData {
  validateDg2Bytes(dg2Image);
  validateVideoBytes(video);

  if (typeof faceMatchThreshold === "number") {
    if (!Number.isFinite(faceMatchThreshold)) {
      throw new Error("biometric_verifier_threshold_invalid");
    }

    if (
      faceMatchThreshold < BIOMETRIC_VERIFIER_MIN_THRESHOLD ||
      faceMatchThreshold > BIOMETRIC_VERIFIER_MAX_THRESHOLD
    ) {
      throw new Error("biometric_verifier_threshold_out_of_range");
    }
  }

  const formData = new FormData();

  formData.append(
    BIOMETRIC_VERIFIER_DG2_FIELD,
    blobFromBytes(dg2Image),
    "dg2.bin"
  );
  formData.append(
    BIOMETRIC_VERIFIER_VIDEO_FIELD,
    blobFromBytes(video),
    "liveness.mp4"
  );

  if (poseSequence && poseSequence.length > 0) {
    formData.append(
      BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD,
      JSON.stringify(poseSequence)
    );
  }

  if (challengeNonce && challengeNonce.byteLength > 0) {
    formData.append(
      BIOMETRIC_VERIFIER_CHALLENGE_NONCE_FIELD,
      blobFromBytes(challengeNonce),
      "challenge-nonce.bin"
    );
  }

  if (typeof faceMatchThreshold === "number") {
    formData.append(
      BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD,
      String(faceMatchThreshold)
    );
  }

  return formData;
}

export async function parseBiometricVerifierRequestFormData(
  formData: FormData
): Promise<BiometricVerifierMultipartPayload> {
  const dg2Image = await bytesFromEntry(
    formData.get(BIOMETRIC_VERIFIER_DG2_FIELD),
    "dg2",
    BIOMETRIC_VERIFIER_MAX_DG2_BYTES
  );
  const video = await bytesFromEntry(
    formData.get(BIOMETRIC_VERIFIER_VIDEO_FIELD),
    "video",
    BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES
  );
  const poseSequence = parsePoseSequence(
    formData.get(BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD)
  );
  const faceMatchThreshold = parseThresholdValue(
    formData.get(BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD)
  );

  const challengeNonceEntry = formData.get(
    BIOMETRIC_VERIFIER_CHALLENGE_NONCE_FIELD
  );
  let challengeNonce: Uint8Array | undefined;

  if (challengeNonceEntry instanceof Blob) {
    challengeNonce = new Uint8Array(await challengeNonceEntry.arrayBuffer());
  }

  return {
    dg2Image,
    video,
    poseSequence,
    challengeNonce,
    faceMatchThreshold,
  };
}

export function createBiometricVerifierResponse(
  payload: BiometricVerifierResponsePayload
): BiometricVerifierResponsePayload {
  return {
    livenessPassed: payload.livenessPassed,
    livenessScore: payload.livenessScore,
    faceMatchPassed: payload.faceMatchPassed,
    faceMatchScore: payload.faceMatchScore,
    usedFallback: payload.usedFallback,
    reason: payload.reason,
  };
}
