import {
  type BiometricVerifierFaceMatchResponse,
  biometricVerifierFaceMatchResponseSchema,
} from "@kayle-id/config/biometric-verifier";
import { extractDg2FaceImage } from "../../../apps/api/src/v1/verify/validation";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;
interface ContainerFetcher {
  fetch: FetchLike;
}

interface ContainerFaceMatchRequestPayload {
  dg2Image: {
    bytesBase64: string;
    format: "jpeg" | "jpeg2000";
  };
  faceMatchThreshold?: number;
  includeDebug?: boolean;
  selfies: Array<{ bytesBase64: string }>;
}

export type FaceMatchContainerResult =
  | { kind: "ok"; response: BiometricVerifierFaceMatchResponse }
  | { kind: "error"; status: number | null; code: string; message: string };

export async function verifyFaceMatchWithContainer({
  container,
  dg2Image,
  selfies,
  faceMatchThreshold,
  includeDebug,
}: {
  container: ContainerFetcher;
  dg2Image: Uint8Array;
  selfies: Uint8Array[];
  faceMatchThreshold?: number;
  includeDebug?: boolean;
}): Promise<FaceMatchContainerResult> {
  let dg2Face: ReturnType<typeof extractDg2FaceImage>;
  try {
    dg2Face = extractDg2FaceImage(dg2Image);
  } catch (error) {
    return {
      kind: "error",
      status: 400,
      code: "DG2_DECODE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const payload: ContainerFaceMatchRequestPayload = {
    dg2Image: {
      bytesBase64: Buffer.from(dg2Face.imageData).toString("base64"),
      format: dg2Face.imageFormat,
    },
    selfies: selfies.map((bytes) => ({
      bytesBase64: Buffer.from(bytes).toString("base64"),
    })),
    faceMatchThreshold,
    includeDebug: includeDebug ? true : undefined,
  };

  let response: Response;
  try {
    response = await container.fetch("http://container/verify_face_match", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    return {
      kind: "error",
      status: null,
      code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const code =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error?: { code?: string } }).error?.code === "string"
        ? (json as { error: { code: string } }).error.code
        : `container_http_${response.status}`;
    const message =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error?: { message?: string } }).error?.message ===
        "string"
        ? (json as { error: { message: string } }).error.message
        : `container returned ${response.status}`;
    return { kind: "error", status: response.status, code, message };
  }

  const parsed = biometricVerifierFaceMatchResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      kind: "error",
      status: response.status,
      code: "INVALID_CONTAINER_RESPONSE",
      message: parsed.error.message,
    };
  }
  return { kind: "ok", response: parsed.data };
}
