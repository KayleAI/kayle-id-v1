import { constantTimeStringEqual } from "@kayle-id/config/constant-time";
import {
  createFaceMatcherResponse,
  FACE_MATCHER_AUTH_HEADER,
  FACE_MATCHER_MAX_REQUEST_BYTES,
  type FaceMatcherMultipartPayload,
  faceMatcherResponseSchema,
  parseFaceMatcherRequestFormData,
} from "@kayle-id/config/face-matcher";
import {
  createSafeRequestLogger,
  emitSafeRequestLog,
  initStructuredLogger,
  logEvent,
  logSafeError,
  type SafeRequestLogger,
} from "@kayle-id/config/logging";
import {
  isRequestBodyTooLarge,
  readRequestBytesWithLimit,
} from "@kayle-id/config/request-body";
import pkg from "../../../package.json" with { type: "json" };
import { matchFacesWithContainer } from "./matcher";

export const FACE_MATCHER_MODEL_PATH =
  "/app/models/face_recognition_sface_2021dec.onnx";
export const FACE_MATCHER_DETECTOR_PATH =
  "/app/models/face_detection_yunet_2023mar.onnx";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;
export interface ContainerFetcher {
  fetch: FetchLike;
}

type GetContainer = (env: unknown) => Promise<ContainerFetcher | null>;
type FaceMatcherRequestLogger = SafeRequestLogger;

interface FaceMatcherWorkerOptions {
  emitRequestLogs?: boolean;
  getContainer?: GetContainer;
}

initStructuredLogger({
  environment: process.env.NODE_ENV,
  service: pkg.name,
  version: pkg.version,
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

type InternalAuthOutcome =
  | { ok: true }
  | { ok: false; reason: "secret_missing" | "credentials_invalid" };

function authorizeInternalRequest(
  request: Request,
  matcherSecret?: string
): InternalAuthOutcome {
  if (!(typeof matcherSecret === "string" && matcherSecret.length > 0)) {
    return { ok: false, reason: "secret_missing" };
  }

  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  const sharedSecretHeader = request.headers.get(FACE_MATCHER_AUTH_HEADER);
  const headerMatch = [sharedSecretHeader, bearerToken].some(
    (candidate) =>
      typeof candidate === "string" &&
      constantTimeStringEqual(candidate, matcherSecret)
  );

  return headerMatch
    ? { ok: true }
    : { ok: false, reason: "credentials_invalid" };
}

function resolveStringEnvValue(env: unknown, key: string): string | null {
  if (!(env && typeof env === "object")) {
    return null;
  }

  const candidate = Reflect.get(env, key);
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

async function proxyHealth(
  container: ContainerFetcher | null,
  logger: FaceMatcherRequestLogger
): Promise<Response> {
  if (!container) {
    logEvent(logger, {
      details: {
        error_code: "face_matcher_container_binding_missing",
      },
      event: "face_matcher.health_unavailable",
      level: "warn",
    });

    return jsonResponse(
      {
        data: {
          modelPath: FACE_MATCHER_MODEL_PATH,
          ready: false,
          status: "unhealthy",
        },
        error: {
          code: "MATCHER_UNAVAILABLE",
          message: "Face matcher container binding is unavailable.",
        },
      },
      503
    );
  }

  try {
    return await container.fetch("http://container/health");
  } catch (error) {
    logSafeError(logger, {
      code: "face_matcher_health_unavailable",
      error,
      event: "face_matcher.health_unavailable",
      message: "Face matcher health check failed.",
      status: 503,
    });

    return jsonResponse(
      {
        data: {
          modelPath: FACE_MATCHER_MODEL_PATH,
          ready: false,
          status: "unhealthy",
        },
        error: {
          code: "MATCHER_UNAVAILABLE",
          message: "Face matcher health check failed.",
        },
      },
      503
    );
  }
}

async function parseMatchPayload({
  request,
  logger,
}: {
  request: Request;
  logger: FaceMatcherRequestLogger;
}): Promise<FaceMatcherMultipartPayload | Response> {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType) {
      throw new Error("face_matcher_content_type_missing");
    }

    const bodyBytes = await readRequestBytesWithLimit(
      request,
      FACE_MATCHER_MAX_REQUEST_BYTES
    );
    const boundedRequest = new Request(request.url, {
      body: bodyBytes as unknown as BodyInit,
      headers: {
        "content-type": contentType,
      },
      method: request.method,
    });

    return await parseFaceMatcherRequestFormData(
      await boundedRequest.formData()
    );
  } catch (error) {
    const bodyTooLarge = isRequestBodyTooLarge(error);
    const status = bodyTooLarge ? 413 : 400;

    logSafeError(logger, {
      code: bodyTooLarge
        ? "face_matcher_request_too_large"
        : "face_matcher_invalid_request",
      error,
      event: bodyTooLarge
        ? "face_matcher.request_too_large"
        : "face_matcher.invalid_request",
      message: bodyTooLarge
        ? "Face matcher request payload is too large."
        : "Face matcher request payload is invalid.",
      status,
    });

    return jsonResponse(
      {
        error: {
          code: bodyTooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
          message: bodyTooLarge
            ? "Face matcher request payload is too large."
            : "Face matcher request payload is invalid.",
        },
      },
      status
    );
  }
}

async function handleMatchRequest({
  env,
  getContainer,
  request,
  logger,
}: {
  env: FaceMatcherBindings;
  getContainer: GetContainer;
  request: Request;
  logger: FaceMatcherRequestLogger;
}): Promise<Response> {
  const matcherSecret =
    resolveStringEnvValue(env, "FACE_MATCHER_SECRET") ?? undefined;
  const authOutcome = authorizeInternalRequest(request, matcherSecret);

  if (!authOutcome.ok) {
    if (authOutcome.reason === "secret_missing") {
      // Fail closed when the worker is missing the shared secret. Treat this
      // as misconfiguration (503) rather than UNAUTHORIZED (401) so the API
      // side can distinguish "deploy is broken" from "caller sent the wrong
      // header" and alert on it.
      logEvent(logger, {
        details: {
          error_code: "face_matcher_secret_missing",
          status: 503,
        },
        event: "face_matcher.misconfigured",
        level: "warn",
      });

      return jsonResponse(
        {
          error: {
            code: "MATCHER_MISCONFIGURED",
            message: "Face matcher is missing its shared secret.",
          },
        },
        503
      );
    }

    logEvent(logger, {
      details: {
        error_code: "face_matcher_unauthorized",
        status: 401,
      },
      event: "face_matcher.unauthorized",
      level: "warn",
    });

    return jsonResponse(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized matcher request.",
        },
      },
      401
    );
  }

  const payload = await parseMatchPayload({
    request,
    logger,
  });

  if (payload instanceof Response) {
    return payload;
  }

  const container = await getContainer(env);
  const startedAt = Date.now();
  const result = await matchFacesWithContainer({
    container: container ?? {
      fetch: async () =>
        new Response(null, {
          status: 503,
        }),
    },
    dg2Image: payload.dg2Image,
    selfies: payload.selfies,
    threshold: payload.threshold,
  });
  const response = faceMatcherResponseSchema.parse(
    createFaceMatcherResponse(result)
  );

  logEvent(logger, {
    details: {
      duration_ms: Date.now() - startedAt,
      dg2_bytes: payload.dg2Image.length,
      selfie_count: payload.selfies.length,
      selfie_bytes: payload.selfies.reduce(
        (total: number, selfie: Uint8Array) => total + selfie.length,
        0
      ),
      threshold: payload.threshold ?? null,
      face_score: response.faceScore,
      passed: response.passed,
      used_fallback: response.usedFallback,
      reason: response.reason ?? null,
    },
    event: "face_matcher.completed",
  });

  return jsonResponse(response);
}

export function createFaceMatcherWorker({
  emitRequestLogs = true,
  getContainer = async () => null,
}: FaceMatcherWorkerOptions = {}): Required<
  Pick<ExportedHandler<FaceMatcherBindings>, "fetch">
> {
  return {
    fetch: async (request, env) => {
      const logger = createSafeRequestLogger(request);
      const emitRequestLog = (status: number) => {
        if (emitRequestLogs) {
          emitSafeRequestLog(logger, status);
        }
      };
      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/health") {
          const response = await proxyHealth(await getContainer(env), logger);
          emitRequestLog(response.status);
          return response;
        }

        if (request.method === "POST" && url.pathname === "/match") {
          const response = await handleMatchRequest({
            env,
            getContainer,
            logger,
            request,
          });
          emitRequestLog(response.status);
          return response;
        }

        logEvent(logger, {
          details: {
            error_code: "face_matcher_route_not_found",
            status: 404,
          },
          event: "face_matcher.not_found",
          level: "warn",
        });

        const response = jsonResponse(
          {
            error: {
              code: "NOT_FOUND",
              message: "Face matcher route was not found.",
            },
          },
          404
        );
        emitRequestLog(response.status);
        return response;
      } catch (error) {
        logSafeError(logger, {
          code: "face_matcher_request_failed",
          error,
          event: "face_matcher.request_failed",
          message: "Face matcher request failed.",
          status: 500,
        });
        emitRequestLog(500);
        throw error;
      }
    },
  };
}
