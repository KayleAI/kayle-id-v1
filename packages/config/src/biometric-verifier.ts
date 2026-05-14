import { z } from "zod";

export const BIOMETRIC_VERIFIER_AUTH_HEADER = "x-kayle-biometric-verifier-auth";
export const BIOMETRIC_VERIFIER_DG2_FIELD = "dg2";
export const BIOMETRIC_VERIFIER_VIDEO_FIELD = "video";
export const BIOMETRIC_VERIFIER_CHALLENGE_NONCE_FIELD = "challengeNonce";
export const BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD =
  "faceMatchThreshold";
export const BIOMETRIC_VERIFIER_INCLUDE_DEBUG_FIELD = "includeDebug";
export const BIOMETRIC_VERIFIER_SKIP_FACE_MATCH_FIELD = "skipFaceMatch";

export const BIOMETRIC_VERIFIER_MAX_DG2_BYTES = 4 * 1024 * 1024;
export const BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES = 16 * 1024 * 1024;
// dg2 + video + form/multipart overhead headroom.
export const BIOMETRIC_VERIFIER_MAX_REQUEST_BYTES =
  BIOMETRIC_VERIFIER_MAX_DG2_BYTES +
  BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES +
  256 * 1024;
export const BIOMETRIC_VERIFIER_MAX_THRESHOLD = 1;
export const BIOMETRIC_VERIFIER_MIN_THRESHOLD = 0;

// The container classifier emits "unknown" for frames where yaw can't be
// estimated (no face) or falls in the dead zone between center and an
// extreme. Production response shape only carries verdicts, but the debug
// timeline records the raw per-frame classification.
const livenessDebugPoseSchema = z.enum(["center", "left", "right", "unknown"]);

const livenessLandmarkPointSchema = z.tuple([z.number(), z.number()]);

const livenessDebugBboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  confidence: z.number(),
});

// YuNet emits 5 landmarks per detected face. Naming follows the IMAGE's
// perspective, matching the columns YuNet returns. `rightEye` is therefore
// the eye on the image's right side — which, in an un-mirrored front-camera
// capture, is the subject's LEFT eye. The overlay renders them as-is on the
// played-back video, so naming-by-image-side is what the viewer sees.
const livenessDebugLandmarksSchema = z.object({
  rightEye: livenessLandmarkPointSchema,
  leftEye: livenessLandmarkPointSchema,
  nose: livenessLandmarkPointSchema,
  rightMouth: livenessLandmarkPointSchema,
  leftMouth: livenessLandmarkPointSchema,
});

// Mesh debug shape: emitted only when the container is running in
// development mode (NODE_ENV=development) AND the request asks for
// debug. We send only an identity-stable subset (~12 anchored points)
// rather than the full 478×3 — the full mesh would balloon the debug
// payload past 500 KB on a typical clip while adding nothing the
// overlay can't render from the subset.
const livenessLandmarkPoint3dSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
]);

const livenessMeshSubsetSchema = z.object({
  subsetPoints: z.array(livenessLandmarkPoint3dSchema),
  subsetIndices: z.array(z.number().int().nonnegative()),
});

const livenessDebugTimelineEntrySchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  faceDetected: z.boolean(),
  pitchDeg: z.number().nullish(),
  yawDeg: z.number().nullable(),
  rollDeg: z.number().nullish(),
  pose: livenessDebugPoseSchema,
  padScore: z.number().min(0).max(1).nullable(),
  bbox: livenessDebugBboxSchema.nullable(),
  landmarks: livenessDebugLandmarksSchema.nullable(),
  mesh: livenessMeshSubsetSchema.nullish(),
});

export const livenessDebugSchema = z.object({
  frameCount: z.number().int().nonnegative(),
  durationSeconds: z.number().nullable(),
  frameWidth: z.number().int().nonnegative(),
  frameHeight: z.number().int().nonnegative(),
  centerFrameIndex: z.number().int().nonnegative().nullable(),
  timeline: z.array(livenessDebugTimelineEntrySchema),
  padFrameThreshold: z.number().nullable(),
  padPassFraction: z.number().nullable(),
  padScoredFrames: z.number().int().nonnegative(),
  padPassingFrames: z.number().int().nonnegative(),
  // PAD is on by default now; `padDisabled` is the emergency
  // kill-switch flag (`BIOMETRIC_VERIFIER_PAD_DISABLED=1`).
  // `padLoaded` reflects whether onnxruntime actually got both
  // sessions up (the dual-model ensemble requires V2 + V1SE).
  padDisabled: z.boolean(),
  padLoaded: z.boolean(),
  // Mesh model is always-on by default; `meshDisabled` is the
  // emergency kill-switch flag (`BIOMETRIC_VERIFIER_MESH_DISABLED=1`).
  // `meshLoaded` reflects whether onnxruntime actually got a session
  // — false means file missing, kill-switch on, or load error.
  meshDisabled: z.boolean().optional(),
  meshLoaded: z.boolean().optional(),
  dg2Mesh: livenessMeshSubsetSchema.nullish(),
});

export type LivenessDebugBbox = z.infer<typeof livenessDebugBboxSchema>;
export type LivenessDebugLandmarks = z.infer<
  typeof livenessDebugLandmarksSchema
>;

export type LivenessDebugPayload = z.infer<typeof livenessDebugSchema>;
export type LivenessDebugTimelineEntry = z.infer<
  typeof livenessDebugTimelineEntrySchema
>;

export const biometricVerifierResponseSchema = z.object({
  livenessPassed: z.boolean(),
  livenessScore: z.number().min(0).max(1).nullable(),
  faceMatchPassed: z.boolean(),
  faceMatchScore: z.number().min(0).max(1).nullable(),
  // Presentation-attack detection. `padPassed` is true when the gate is
  // satisfied (or when PAD is disabled / model not loaded — in which case
  // the container also nulls out `padScore`). The verdict gate in the api
  // requires this true alongside livenessPassed and faceMatchPassed.
  padPassed: z.boolean(),
  padScore: z.number().min(0).max(1).nullable(),
  usedFallback: z.boolean(),
  // `.nullish()` accepts both `null` and `undefined` — the container
  // emits `null` on the happy path; older test mocks omit the field.
  reason: z.string().nullish(),
  // Which alignment produced `faceMatchScore`: "mesh" (preferred,
  // both sides had a 478-pt mesh embedding), "yunet" (fallback), or
  // null when no face match was produced.
  faceMatchAlignment: z.enum(["mesh", "yunet"]).nullable(),
  // Only populated when `includeDebug=1` is set AND the container is
  // running in development mode.
  debug: livenessDebugSchema.nullish(),
});

export type BiometricVerifierResponsePayload = z.infer<
  typeof biometricVerifierResponseSchema
>;

export interface BiometricVerifierMultipartPayload {
  challengeNonce?: Uint8Array;
  dg2Image: Uint8Array;
  faceMatchThreshold?: number;
  /** Attach the per-frame pose/yaw/PAD timeline to the response. Dev-only. */
  includeDebug?: boolean;
  /**
   * Skip the DG2 face-match step. Honoured only when the container is
   * running in development mode (`NODE_ENV=development`); production
   * wrangler sets `NODE_ENV=production`, so this is a no-op there.
   */
  skipFaceMatch?: boolean;
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
  challengeNonce,
  faceMatchThreshold,
  includeDebug,
  skipFaceMatch,
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

  if (includeDebug) {
    formData.append(BIOMETRIC_VERIFIER_INCLUDE_DEBUG_FIELD, "1");
  }

  if (skipFaceMatch) {
    formData.append(BIOMETRIC_VERIFIER_SKIP_FACE_MATCH_FIELD, "1");
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

  const includeDebugEntry = formData.get(
    BIOMETRIC_VERIFIER_INCLUDE_DEBUG_FIELD
  );
  const includeDebug =
    typeof includeDebugEntry === "string" && includeDebugEntry === "1";

  const skipFaceMatchEntry = formData.get(
    BIOMETRIC_VERIFIER_SKIP_FACE_MATCH_FIELD
  );
  const skipFaceMatch =
    typeof skipFaceMatchEntry === "string" && skipFaceMatchEntry === "1";

  return {
    dg2Image,
    video,
    challengeNonce,
    faceMatchThreshold,
    includeDebug,
    skipFaceMatch,
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
    faceMatchAlignment: payload.faceMatchAlignment,
    padPassed: payload.padPassed,
    padScore: payload.padScore,
    usedFallback: payload.usedFallback,
    reason: payload.reason,
    debug: payload.debug,
  };
}
