import { describe, expect, test } from "bun:test";
import {
  createFaceMatcherRequestFormData,
  FACE_MATCHER_DG2_FIELD,
  FACE_MATCHER_MAX_IMAGE_BYTES,
  FACE_MATCHER_MAX_SELFIES,
  FACE_MATCHER_SELFIE_FIELD_PREFIX,
  FACE_MATCHER_THRESHOLD_FIELD,
  parseFaceMatcherRequestFormData,
} from "./face-matcher";

const byteArray = (length: number): Uint8Array =>
  new Uint8Array(length).fill(1);

const appendBinaryField = (
  formData: FormData,
  fieldName: string,
  bytes: Uint8Array
) => {
  formData.append(fieldName, new Blob([bytes]), `${fieldName}.bin`);
};

describe("face matcher multipart contract", () => {
  test("accepts a bounded dg2 image and selfie set", async () => {
    const formData = createFaceMatcherRequestFormData({
      dg2Image: byteArray(16),
      selfies: [byteArray(12), byteArray(14)],
      threshold: 0.75,
    });

    const parsed = await parseFaceMatcherRequestFormData(formData);

    expect(parsed.dg2Image.byteLength).toBe(16);
    expect(parsed.selfies).toHaveLength(2);
    expect(parsed.threshold).toBe(0.75);
  });

  test("rejects images larger than the face matcher contract allows", async () => {
    const formData = new FormData();
    appendBinaryField(
      formData,
      FACE_MATCHER_DG2_FIELD,
      byteArray(FACE_MATCHER_MAX_IMAGE_BYTES + 1)
    );
    appendBinaryField(
      formData,
      `${FACE_MATCHER_SELFIE_FIELD_PREFIX}0`,
      byteArray(1)
    );

    await expect(parseFaceMatcherRequestFormData(formData)).rejects.toThrow(
      "face_matcher_dg2_too_large"
    );
  });

  test("rejects more selfies than the verify flow can produce", async () => {
    const formData = new FormData();
    appendBinaryField(formData, FACE_MATCHER_DG2_FIELD, byteArray(1));

    for (let index = 0; index <= FACE_MATCHER_MAX_SELFIES; index += 1) {
      appendBinaryField(
        formData,
        `${FACE_MATCHER_SELFIE_FIELD_PREFIX}${index}`,
        byteArray(1)
      );
    }

    await expect(parseFaceMatcherRequestFormData(formData)).rejects.toThrow(
      "face_matcher_selfie_index_too_large"
    );
  });

  test("rejects thresholds outside the score range", async () => {
    const formData = new FormData();
    appendBinaryField(formData, FACE_MATCHER_DG2_FIELD, byteArray(1));
    appendBinaryField(
      formData,
      `${FACE_MATCHER_SELFIE_FIELD_PREFIX}0`,
      byteArray(1)
    );
    formData.append(FACE_MATCHER_THRESHOLD_FIELD, "1.5");

    await expect(parseFaceMatcherRequestFormData(formData)).rejects.toThrow(
      "face_matcher_threshold_out_of_range"
    );
  });
});
