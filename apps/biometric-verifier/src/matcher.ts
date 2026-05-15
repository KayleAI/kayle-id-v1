import {
  type BiometricVerifierResponsePayload,
  biometricVerifierResponseSchema,
} from "@kayle-id/config/biometric-verifier";
import {
  type Dg2FaceImage,
  extractDg2FaceImage,
} from "@kayle-id/config/dg2-face-image";

interface ContainerLivenessRequestPayload {
  challengeNonceBase64?: string;
  dg2Image: {
    bytesBase64: string;
    format: Dg2FaceImage["imageFormat"];
  };
  faceMatchThreshold?: number;
  includeDebug?: boolean;
  skipFaceMatch?: boolean;
  videoBase64: string;
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

async function requestContainerLiveness({
  container,
  payload,
}: {
  container: ContainerFetcher;
  payload: ContainerLivenessRequestPayload;
}): Promise<LivenessContainerResult> {
  try {
    const response = await container.fetch("http://container/verify", {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
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
        bytesBase64: Buffer.from(dg2FaceImage.imageData).toString("base64"),
        format: dg2FaceImage.imageFormat,
      },
      videoBase64: Buffer.from(video).toString("base64"),
      challengeNonceBase64:
        challengeNonce && challengeNonce.byteLength > 0
          ? Buffer.from(challengeNonce).toString("base64")
          : undefined,
      faceMatchThreshold,
      includeDebug: includeDebug ? true : undefined,
      skipFaceMatch: skipFaceMatch ? true : undefined,
    },
  });
}
