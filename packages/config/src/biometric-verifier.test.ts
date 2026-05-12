import { describe, expect, test } from "bun:test";
import {
  BIOMETRIC_VERIFIER_DG2_FIELD,
  BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD,
  BIOMETRIC_VERIFIER_MAX_DG2_BYTES,
  BIOMETRIC_VERIFIER_MAX_VIDEO_BYTES,
  BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD,
  BIOMETRIC_VERIFIER_VIDEO_FIELD,
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

describe("biometric verifier multipart contract", () => {
  test("accepts a bounded dg2 + video + pose sequence", async () => {
    const formData = createBiometricVerifierRequestFormData({
      dg2Image: byteArray(16),
      video: byteArray(2048),
      poseSequence: ["center", "left", "right"],
      faceMatchThreshold: 0.75,
    });

    const parsed = await parseBiometricVerifierRequestFormData(formData);

    expect(parsed.dg2Image.byteLength).toBe(16);
    expect(parsed.video.byteLength).toBe(2048);
    expect(parsed.poseSequence).toEqual(["center", "left", "right"]);
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
    formData.append(
      BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD,
      JSON.stringify(["center", "left", "right"])
    );

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
    formData.append(
      BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD,
      JSON.stringify(["center", "left", "right"])
    );

    await expect(
      parseBiometricVerifierRequestFormData(formData)
    ).rejects.toThrow("biometric_verifier_video_too_large");
  });

  test("rejects an invalid pose sequence", async () => {
    const formData = new FormData();
    appendBinaryField(formData, BIOMETRIC_VERIFIER_DG2_FIELD, byteArray(16));
    appendBinaryField(formData, BIOMETRIC_VERIFIER_VIDEO_FIELD, byteArray(64));
    formData.append(
      BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD,
      JSON.stringify(["center", "up"])
    );

    await expect(
      parseBiometricVerifierRequestFormData(formData)
    ).rejects.toThrow("biometric_verifier_pose_sequence_invalid");
  });

  test("rejects thresholds outside the score range", async () => {
    const formData = new FormData();
    appendBinaryField(formData, BIOMETRIC_VERIFIER_DG2_FIELD, byteArray(16));
    appendBinaryField(formData, BIOMETRIC_VERIFIER_VIDEO_FIELD, byteArray(64));
    formData.append(
      BIOMETRIC_VERIFIER_POSE_SEQUENCE_FIELD,
      JSON.stringify(["center"])
    );
    formData.append(BIOMETRIC_VERIFIER_FACE_MATCH_THRESHOLD_FIELD, "1.5");

    await expect(
      parseBiometricVerifierRequestFormData(formData)
    ).rejects.toThrow("biometric_verifier_threshold_out_of_range");
  });
});
