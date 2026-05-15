import { describe, expect, test } from "bun:test";
import {
  BIOMETRIC_VERIFIER_DG2_FIELD,
  BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD,
  BIOMETRIC_VERIFIER_MAX_DG2_BYTES,
  BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES,
  BIOMETRIC_VERIFIER_VIDEO_FIELD,
  biometricVerifierResponseSchema,
  createBiometricVerifierRequestFormData,
  parseBiometricVerifierRequestFormData,
} from "./biometric-verifier";

const byteArray = (length: number): Uint8Array =>
  new Uint8Array(length).fill(1);

const appendBinaryField = (
  formData: FormData,
  fieldName: string,
  bytes: Uint8Array
) => {
  formData.append(fieldName, new Blob([bytes]), `${fieldName}.bin`);
};

// faceMatchAlignment default — tests use this to stay declarative about
// which slot they're varying.
const FACE_MATCH_ALIGNMENT_DEFAULT = {
  faceMatchAlignment: null,
};

describe("biometric verifier multipart contract", () => {
  test("accepts a bounded dg2 + video", async () => {
    const formData = createBiometricVerifierRequestFormData({
      dg2Image: byteArray(16),
      video: byteArray(2048),
      faceMatchThreshold: 0.75,
    });

    const parsed = await parseBiometricVerifierRequestFormData(formData);

    expect(parsed.dg2Image.byteLength).toBe(16);
    expect(parsed.video.byteLength).toBe(2048);
    expect(parsed.faceMatchThreshold).toBe(0.75);
  });

  test("rejects dg2 images larger than the contract allows", async () => {
    const formData = new FormData();
    appendBinaryField(
      formData,
      BIOMETRIC_VERIFIER_DG2_FIELD,
      byteArray(BIOMETRIC_VERIFIER_MAX_DG2_BYTES + 1)
    );
    appendBinaryField(formData, BIOMETRIC_VERIFIER_VIDEO_FIELD, byteArray(64));

    await expect(
      parseBiometricVerifierRequestFormData(formData)
    ).rejects.toThrow("biometric_verifier_dg2_too_large");
  });

  test("rejects videos larger than the contract allows", async () => {
    const formData = new FormData();
    appendBinaryField(formData, BIOMETRIC_VERIFIER_DG2_FIELD, byteArray(16));
    appendBinaryField(
      formData,
      BIOMETRIC_VERIFIER_VIDEO_FIELD,
      byteArray(BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES + 1)
    );

    await expect(
      parseBiometricVerifierRequestFormData(formData)
    ).rejects.toThrow("biometric_verifier_video_too_large");
  });

  test("rejects thresholds outside the score range", async () => {
    const formData = new FormData();
    appendBinaryField(formData, BIOMETRIC_VERIFIER_DG2_FIELD, byteArray(16));
    appendBinaryField(formData, BIOMETRIC_VERIFIER_VIDEO_FIELD, byteArray(64));
    formData.append(BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD, "1.5");

    await expect(
      parseBiometricVerifierRequestFormData(formData)
    ).rejects.toThrow("biometric_verifier_threshold_out_of_range");
  });
});

describe("biometric verifier response schema", () => {
  test("accepts the happy path with faceMatchAlignment populated", () => {
    const parsed = biometricVerifierResponseSchema.safeParse({
      livenessPassed: true,
      livenessScore: 0.95,
      faceMatchPassed: true,
      faceMatchScore: 0.88,
      faceMatchAlignment: "mesh",
      padPassed: true,
      padScore: 0.91,
      usedFallback: false,
      reason: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.faceMatchAlignment).toBe("mesh");
    }
  });

  test("accepts faceMatchAlignment null when no face match was produced", () => {
    const parsed = biometricVerifierResponseSchema.safeParse({
      livenessPassed: false,
      livenessScore: 0.5,
      faceMatchPassed: false,
      faceMatchScore: null,
      padPassed: false,
      padScore: null,
      ...FACE_MATCH_ALIGNMENT_DEFAULT,
      usedFallback: false,
      reason: "liveness_no_face",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects responses missing faceMatchAlignment", () => {
    // The container always populates faceMatchAlignment (null when no
    // match was produced). Dropping it from the response shape is a
    // silent contract break — we want a hard parse failure instead.
    const parsed = biometricVerifierResponseSchema.safeParse({
      livenessPassed: true,
      livenessScore: 0.95,
      faceMatchPassed: true,
      faceMatchScore: 0.88,
      padPassed: true,
      padScore: 0.91,
      usedFallback: false,
      reason: null,
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects faceMatchAlignment with an unknown enum value", () => {
    const parsed = biometricVerifierResponseSchema.safeParse({
      livenessPassed: true,
      livenessScore: 0.95,
      faceMatchPassed: true,
      faceMatchScore: 0.88,
      faceMatchAlignment: "pixel-correlation",
      padPassed: true,
      padScore: 0.91,
      usedFallback: false,
      reason: null,
    });
    expect(parsed.success).toBe(false);
  });
});
