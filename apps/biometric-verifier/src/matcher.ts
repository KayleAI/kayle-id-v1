import {
  type BiometricVerifierResponsePayload,
  biometricVerifierResponseSchema,
} from "@kayle-id/config/biometric-verifier";
import {
  type Dg2FaceImage,
  extractDg2FaceImage,
} from "@kayle-id/config/dg2-face-image";

interface ContainerLivenessRequestPayload {
  challengeNonce?: Uint8Array;
  dg2Image: {
    bytes: Uint8Array;
    format: Dg2FaceImage["imageFormat"];
  };
  faceMatchThreshold?: number;
  includeDebug?: boolean;
  skipFaceMatch?: boolean;
  video: Uint8Array;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;
interface ContainerFetcher {
  fetch: FetchLike;
}

export type LivenessContainerResult = BiometricVerifierResponsePayload;

function createUnavailableResult(reason: string): LivenessContainerResult {
  return {
    livenessPassed: false,
    livenessScore: null,
    faceMatchPassed: false,
    faceMatchScore: null,
    faceMatchAlignment: null,
    padPassed: false,
    padScore: null,
    usedFallback: true,
    reason,
  };
}

function createContainerLivenessFormData(
  payload: ContainerLivenessRequestPayload
): FormData {
  const formData = new FormData();
  formData.set("dg2Image", new Blob([payload.dg2Image.bytes]));
  formData.set("dg2Format", payload.dg2Image.format);
  formData.set("video", new Blob([payload.video]));

  if (payload.challengeNonce && payload.challengeNonce.byteLength > 0) {
    formData.set("challengeNonce", new Blob([payload.challengeNonce]));
  }
  if (typeof payload.faceMatchThreshold === "number") {
    formData.set("faceMatchThreshold", String(payload.faceMatchThreshold));
  }
  if (payload.includeDebug) {
    formData.set("includeDebug", "true");
  }
  if (payload.skipFaceMatch) {
    formData.set("skipFaceMatch", "true");
  }

  return formData;
}

async function requestContainerLiveness({
  container,
  payload,
}: {
  container: ContainerFetcher;
  payload: ContainerLivenessRequestPayload;
}): Promise<LivenessContainerResult> {
  try {
    const response = await container.fetch("http://container/verify", {
      body: createContainerLivenessFormData(payload),
      method: "POST",
    });

    if (!response.ok) {
      return createUnavailableResult(
        `biometric_verifier_unavailable:container_http_${response.status}`
      );
    }

    const json = await response.json().catch(() => null);

    if (json === null) {
      return createUnavailableResult(
        "biometric_verifier_unavailable:container_invalid_json"
      );
    }

    const parsedResponse = biometricVerifierResponseSchema.safeParse(json);

    if (!parsedResponse.success) {
      return createUnavailableResult(
        "biometric_verifier_unavailable:container_invalid_response"
      );
    }

    return parsedResponse.data;
  } catch {
    // Fixed code instead of error.message — keeps the `reason` field stable.
    return createUnavailableResult(
      "biometric_verifier_unavailable:container_request_failed"
    );
  }
}

export function verifyLivenessWithContainer({
  container,
  dg2Image,
  video,
  challengeNonce,
  faceMatchThreshold,
  includeDebug,
  skipFaceMatch,
}: {
  container: ContainerFetcher;
  dg2Image: Uint8Array;
  video: Uint8Array;
  challengeNonce?: Uint8Array;
  faceMatchThreshold?: number;
  includeDebug?: boolean;
  skipFaceMatch?: boolean;
}): Promise<LivenessContainerResult> {
  if (video.byteLength === 0) {
    return Promise.resolve(createUnavailableResult("liveness_video_missing"));
  }

  let dg2FaceImage: Dg2FaceImage;

  try {
    dg2FaceImage = extractDg2FaceImage(dg2Image);
  } catch (error) {
    return Promise.resolve(
      createUnavailableResult(
        `face_score_dg2_extract_failed:${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
  }

  return requestContainerLiveness({
    container,
    payload: {
      dg2Image: {
        bytes: dg2FaceImage.imageData,
        format: dg2FaceImage.imageFormat,
      },
      video,
      challengeNonce,
      faceMatchThreshold,
      includeDebug: includeDebug ? true : undefined,
      skipFaceMatch: skipFaceMatch ? true : undefined,
    },
  });
}
