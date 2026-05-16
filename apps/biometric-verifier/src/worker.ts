import {
  BIOMETRIC_VERIFIER_AUTH_HEADER,
  BIOMETRIC_VERIFIER_MAX_REQUEST_BYTES,
  type BiometricVerifierMultipartPayload,
  biometricVerifierResponseSchema,
  createBiometricVerifierResponse,
  createBiometricVerifierTestStubResponse,
  parseBiometricVerifierRequestFormData,
  parseBiometricVerifierTestStubVerdict,
} from "@kayle-id/config/biometric-verifier";
import { constantTimeStringEqual } from "@kayle-id/config/constant-time";
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
import { verifyLivenessWithContainer } from "./matcher";

export const BIOMETRIC_VERIFIER_MODEL_PATH =
  "/app/models/auraface_glintr100.onnx";
export const BIOMETRIC_VERIFIER_DETECTOR_PATH =
  "/app/models/face_detection_yunet_2023mar.onnx";
export const BIOMETRIC_VERIFIER_MESH_MODEL_PATH =
  "/app/models/face_landmarks_detector.onnx";
const CONTAINER_READY_ATTEMPTS = 80;
const CONTAINER_READY_RETRY_DELAY_MS = 250;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;
export interface ContainerFetcher {
  fetch: FetchLike;
}

type GetContainer = (env: unknown) => Promise<ContainerFetcher | null>;
type BiometricVerifierRequestLogger = SafeRequestLogger;

interface BiometricVerifierWorkerOptions {
  containerReadyAttempts?: number;
  containerReadyRetryDelayMs?: number;
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
  verifierSecret?: string
): InternalAuthOutcome {
  if (!(typeof verifierSecret === "string" && verifierSecret.length > 0)) {
    return { ok: false, reason: "secret_missing" };
  }

  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  const sharedSecretHeader = request.headers.get(
    BIOMETRIC_VERIFIER_AUTH_HEADER
  );
  const headerMatch = [sharedSecretHeader, bearerToken].some(
    (candidate) =>
      typeof candidate === "string" &&
      constantTimeStringEqual(candidate, verifierSecret)
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseContainerReady(payload: unknown): boolean {
  if (!isObjectRecord(payload)) {
    return false;
  }

  const data = payload.data;
  return isObjectRecord(data) && data.ready === true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForContainerReady({
  attempts,
  container,
  logger,
  retryDelayMs,
}: {
  attempts: number;
  container: ContainerFetcher;
  logger: BiometricVerifierRequestLogger;
  retryDelayMs: number;
}): Promise<boolean> {
  const startedAt = Date.now();
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await container.fetch("http://container/health");
      lastStatus = response.status;

      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (parseContainerReady(payload)) {
          if (attempt > 1) {
            logEvent(logger, {
              details: {
                duration_ms: Date.now() - startedAt,
                ready_attempts: attempt,
              },
              event: "biometric_verifier.container_ready_waited",
            });
          }
          return true;
        }
      }
    } catch {
      lastStatus = null;
    }

    if (attempt < attempts) {
      await wait(retryDelayMs);
    }
  }

  logEvent(logger, {
    details: {
      duration_ms: Date.now() - startedAt,
      error_code: "biometric_verifier_container_not_ready",
      last_status: lastStatus,
      ready_attempts: attempts,
    },
    event: "biometric_verifier.container_not_ready",
    level: "warn",
  });
  return false;
}

async function proxyHealth(
  container: ContainerFetcher | null,
  logger: BiometricVerifierRequestLogger
): Promise<Response> {
  if (!container) {
    logEvent(logger, {
      details: {
        error_code: "biometric_verifier_container_binding_missing",
      },
      event: "biometric_verifier.health_unavailable",
      level: "warn",
    });

    return jsonResponse(
      {
        data: {
          modelPath: BIOMETRIC_VERIFIER_MODEL_PATH,
          ready: false,
          status: "unhealthy",
        },
        error: {
          code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
          message: "Biometric verifier container binding is unavailable.",
        },
      },
      503
    );
  }

  try {
    return await container.fetch("http://container/health");
  } catch (error) {
    logSafeError(logger, {
      code: "biometric_verifier_health_unavailable",
      error,
      event: "biometric_verifier.health_unavailable",
      message: "Biometric verifier health check failed.",
      status: 503,
    });

    return jsonResponse(
      {
        data: {
          modelPath: BIOMETRIC_VERIFIER_MODEL_PATH,
          ready: false,
          status: "unhealthy",
        },
        error: {
          code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
          message: "Biometric verifier health check failed.",
        },
      },
      503
    );
  }
}

async function parseLivenessPayload({
  request,
  logger,
}: {
  request: Request;
  logger: BiometricVerifierRequestLogger;
}): Promise<BiometricVerifierMultipartPayload | Response> {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType) {
      throw new Error("biometric_verifier_content_type_missing");
    }

    const bodyBytes = await readRequestBytesWithLimit(
      request,
      BIOMETRIC_VERIFIER_MAX_REQUEST_BYTES
    );
    const boundedRequest = new Request(request.url, {
      body: bodyBytes as unknown as BodyInit,
      headers: {
        "content-type": contentType,
      },
      method: request.method,
    });

    return await parseBiometricVerifierRequestFormData(
      await boundedRequest.formData()
    );
  } catch (error) {
    const bodyTooLarge = isRequestBodyTooLarge(error);
    const status = bodyTooLarge ? 413 : 400;

    logSafeError(logger, {
      code: bodyTooLarge
        ? "biometric_verifier_request_too_large"
        : "biometric_verifier_invalid_request",
      error,
      event: bodyTooLarge
        ? "biometric_verifier.request_too_large"
        : "biometric_verifier.invalid_request",
      message: bodyTooLarge
        ? "Biometric verifier request payload is too large."
        : "Biometric verifier request payload is invalid.",
      status,
    });

    return jsonResponse(
      {
        error: {
          code: bodyTooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
          message: bodyTooLarge
            ? "Biometric verifier request payload is too large."
            : "Biometric verifier request payload is invalid.",
        },
      },
      status
    );
  }
}

async function handleLivenessRequest({
  env,
  getContainer,
  containerReadyAttempts,
  containerReadyRetryDelayMs,
  request,
  logger,
}: {
  containerReadyAttempts: number;
  containerReadyRetryDelayMs: number;
  env: BiometricVerifierBindings;
  getContainer: GetContainer;
  request: Request;
  logger: BiometricVerifierRequestLogger;
}): Promise<Response> {
  const verifierSecret =
    resolveStringEnvValue(env, "BIOMETRIC_VERIFIER_SECRET") ?? undefined;
  const authOutcome = authorizeInternalRequest(request, verifierSecret);

  if (!authOutcome.ok) {
    if (authOutcome.reason === "secret_missing") {
      // Fail closed when the worker is missing the shared secret. Treat this
      // as misconfiguration (503) rather than UNAUTHORIZED (401) so the API
      // side can distinguish "deploy is broken" from "caller sent the wrong
      // header" and alert on it.
      logEvent(logger, {
        details: {
          error_code: "biometric_verifier_secret_missing",
          status: 503,
        },
        event: "biometric_verifier.misconfigured",
        level: "warn",
      });

      return jsonResponse(
        {
          error: {
            code: "BIOMETRIC_VERIFIER_MISCONFIGURED",
            message: "Biometric verifier is missing its shared secret.",
          },
        },
        503
      );
    }

    logEvent(logger, {
      details: {
        error_code: "biometric_verifier_unauthorized",
        status: 401,
      },
      event: "biometric_verifier.unauthorized",
      level: "warn",
    });

    return jsonResponse(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized biometric verifier request.",
        },
      },
      401
    );
  }

  const payload = await parseLivenessPayload({
    request,
    logger,
  });

  if (payload instanceof Response) {
    return payload;
  }

  // Integration tests can opt into a canned verdict by prefixing the
  // uploaded video bytes with `KAYLE_TEST_STUB::<verdict>::`. Gated on
  // `NODE_ENV !== "production"` so this is dead code in prod deploys.
  if (process.env.NODE_ENV !== "production") {
    const stubVerdict = parseBiometricVerifierTestStubVerdict(payload.video);
    if (stubVerdict) {
      const stubResponse = biometricVerifierResponseSchema.parse(
        createBiometricVerifierResponse(
          createBiometricVerifierTestStubResponse(stubVerdict)
        )
      );
      logEvent(logger, {
        details: {
          stub_verdict: stubVerdict,
        },
        event: "biometric_verifier.test_stub_returned",
        level: "warn",
      });
      return jsonResponse(stubResponse);
    }
  }

  const container = await getContainer(env);

  if (!container) {
    logEvent(logger, {
      details: {
        error_code: "biometric_verifier_container_binding_missing",
      },
      event: "biometric_verifier.container_unavailable",
      level: "warn",
    });

    return jsonResponse(
      {
        error: {
          code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
          message: "Biometric verifier container binding is unavailable.",
        },
      },
      503
    );
  }

  const ready = await waitForContainerReady({
    attempts: containerReadyAttempts,
    container,
    logger,
    retryDelayMs: containerReadyRetryDelayMs,
  });

  if (!ready) {
    return jsonResponse(
      {
        error: {
          code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
          message: "Biometric verifier container is not ready.",
        },
      },
      503
    );
  }

  const startedAt = Date.now();
  const result = await verifyLivenessWithContainer({
    container,
    dg2Image: payload.dg2Image,
    video: payload.video,
    challengeNonce: payload.challengeNonce,
    faceMatchThreshold: payload.faceMatchThreshold,
    includeDebug: payload.includeDebug,
    skipFaceMatch: payload.skipFaceMatch,
  });
  const response = biometricVerifierResponseSchema.parse(
    createBiometricVerifierResponse(result)
  );

  logEvent(logger, {
    details: {
      duration_ms: Date.now() - startedAt,
      dg2_bytes: payload.dg2Image.length,
      video_bytes: payload.video.length,
      face_match_threshold: payload.faceMatchThreshold ?? null,
      face_match_passed: response.faceMatchPassed,
      face_match_score: response.faceMatchScore,
      liveness_passed: response.livenessPassed,
      liveness_score: response.livenessScore,
      pad_passed: response.padPassed,
      pad_score: response.padScore,
      face_match_alignment: response.faceMatchAlignment,
      used_fallback: response.usedFallback,
      reason: response.reason ?? null,
    },
    event: "biometric_verifier.completed",
  });

  return jsonResponse(response);
}

async function handlePrewarmRequest({
  env,
  getContainer,
  request,
  logger,
}: {
  env: BiometricVerifierBindings;
  getContainer: GetContainer;
  request: Request;
  logger: BiometricVerifierRequestLogger;
}): Promise<Response> {
  const verifierSecret =
    resolveStringEnvValue(env, "BIOMETRIC_VERIFIER_SECRET") ?? undefined;
  const authOutcome = authorizeInternalRequest(request, verifierSecret);

  if (!authOutcome.ok) {
    if (authOutcome.reason === "secret_missing") {
      return jsonResponse(
        {
          error: {
            code: "BIOMETRIC_VERIFIER_MISCONFIGURED",
            message: "Biometric verifier is missing its shared secret.",
          },
        },
        503
      );
    }
    return jsonResponse(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized biometric verifier request.",
        },
      },
      401
    );
  }

  // Acquiring the container instance is what wakes a sleeping DO. We
  // intentionally don't wait for /health to flip ready — the caller's
  // pattern is "user just hit selfie capture, /verify lands in ~10-15s"
  // and the container has that whole window to finish booting and load
  // models. Returning quickly here keeps the API hop non-blocking.
  const startedAt = Date.now();
  const container = await getContainer(env);
  const triggeredMs = Date.now() - startedAt;

  logEvent(logger, {
    details: {
      duration_ms: triggeredMs,
      container_acquired: container !== null,
    },
    event: "biometric_verifier.prewarm",
  });

  return jsonResponse({
    data: {
      triggered: container !== null,
    },
  });
}

async function handleDebugMetricsRequest({
  env,
  getContainer,
  request,
  logger,
}: {
  env: BiometricVerifierBindings;
  getContainer: GetContainer;
  request: Request;
  logger: BiometricVerifierRequestLogger;
}): Promise<Response> {
  const verifierSecret =
    resolveStringEnvValue(env, "BIOMETRIC_VERIFIER_SECRET") ?? undefined;
  const authOutcome = authorizeInternalRequest(request, verifierSecret);

  if (!authOutcome.ok) {
    if (authOutcome.reason === "secret_missing") {
      return jsonResponse(
        {
          error: {
            code: "BIOMETRIC_VERIFIER_MISCONFIGURED",
            message: "Biometric verifier is missing its shared secret.",
          },
        },
        503
      );
    }
    return jsonResponse(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized biometric verifier request.",
        },
      },
      401
    );
  }

  const container = await getContainer(env);
  if (!container) {
    return jsonResponse(
      {
        error: {
          code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
          message: "Biometric verifier container binding is unavailable.",
        },
      },
      503
    );
  }

  try {
    return await container.fetch("http://container/_debug/metrics");
  } catch (error) {
    logSafeError(logger, {
      code: "biometric_verifier_debug_metrics_unavailable",
      error,
      event: "biometric_verifier.debug_metrics_unavailable",
      message: "Biometric verifier debug metrics fetch failed.",
      status: 502,
    });
    return jsonResponse(
      {
        error: {
          code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
          message: "Biometric verifier debug metrics fetch failed.",
        },
      },
      502
    );
  }
}

export function createBiometricVerifierWorker({
  containerReadyAttempts = CONTAINER_READY_ATTEMPTS,
  containerReadyRetryDelayMs = CONTAINER_READY_RETRY_DELAY_MS,
  emitRequestLogs = true,
  getContainer = async () => null,
}: BiometricVerifierWorkerOptions = {}): Required<
  Pick<ExportedHandler<BiometricVerifierBindings>, "fetch">
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

        if (request.method === "POST" && url.pathname === "/verify") {
          const response = await handleLivenessRequest({
            containerReadyAttempts,
            containerReadyRetryDelayMs,
            env,
            getContainer,
            logger,
            request,
          });
          emitRequestLog(response.status);
          return response;
        }

        if (request.method === "POST" && url.pathname === "/prewarm") {
          const response = await handlePrewarmRequest({
            env,
            getContainer,
            logger,
            request,
          });
          emitRequestLog(response.status);
          return response;
        }

        if (request.method === "GET" && url.pathname === "/_debug/metrics") {
          const response = await handleDebugMetricsRequest({
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
            error_code: "biometric_verifier_route_not_found",
            status: 404,
          },
          event: "biometric_verifier.not_found",
          level: "warn",
        });

        const response = jsonResponse(
          {
            error: {
              code: "NOT_FOUND",
              message: "Biometric verifier route was not found.",
            },
          },
          404
        );
        emitRequestLog(response.status);
        return response;
      } catch (error) {
        logSafeError(logger, {
          code: "biometric_verifier_request_failed",
          error,
          event: "biometric_verifier.request_failed",
          message: "Biometric verifier request failed.",
          status: 500,
        });
        emitRequestLog(500);
        throw error;
      }
    },
  };
}
