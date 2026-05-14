import { Container } from "@cloudflare/containers";
import type { ContainerFetcher } from "./worker";
import {
  BIOMETRIC_VERIFIER_DETECTOR_PATH,
  BIOMETRIC_VERIFIER_MESH_MODEL_PATH,
  BIOMETRIC_VERIFIER_MODEL_PATH,
  createBiometricVerifierWorker,
} from "./worker";

const BIOMETRIC_VERIFIER_CONTAINER_COUNT = 1;
const CONTAINER_HEALTH_ATTEMPTS = 3;
const CONTAINER_HEALTH_RETRY_DELAY_MS = 250;
// Bumped from `face-matcher-v3` so deploys land a fresh durable-object
// instance against the ffmpeg-bearing image + the new liveness pipeline.
// Bump again whenever the image semantics change materially (anti-spoof
// model, codec switch, etc.) so we don't reuse a warm container whose
// pre-loaded models or validation rules diverge from the new code.
const BIOMETRIC_VERIFIER_CONTAINER_NAME_PREFIX = "biometric-verifier-v4";

function resolveContainerBinding(
  env: unknown
): DurableObjectNamespace<BiometricVerifierContainer> | null {
  if (!(env && typeof env === "object")) {
    return null;
  }

  const candidate = Reflect.get(env, "BIOMETRIC_VERIFIER_CONTAINER");

  return candidate
    ? (candidate as DurableObjectNamespace<BiometricVerifierContainer>)
    : null;
}

function createContainerFetchers(
  binding: DurableObjectNamespace<BiometricVerifierContainer>
): ContainerFetcher[] {
  return Array.from(
    { length: BIOMETRIC_VERIFIER_CONTAINER_COUNT },
    (_, index) => {
      const container = binding.get(
        binding.idFromName(
          `${BIOMETRIC_VERIFIER_CONTAINER_NAME_PREFIX}-${index}`
        )
      );

      return {
        fetch: (input, init) => container.fetch(input, init),
      };
    }
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

async function isContainerHealthy(
  container: ContainerFetcher
): Promise<boolean> {
  try {
    const response = await container.fetch("http://container/health");

    if (!response.ok) {
      return false;
    }

    const payload: unknown = await response.json().catch(() => null);

    if (!isObjectRecord(payload)) {
      return false;
    }

    const data = payload.data;

    return isObjectRecord(data) && data.ready === true;
  } catch {
    return false;
  }
}

async function findHealthyContainer(
  containers: ContainerFetcher[]
): Promise<ContainerFetcher | null> {
  for (const container of containers) {
    if (await isContainerHealthy(container)) {
      return container;
    }
  }

  return null;
}

async function getContainerInstance(
  env: unknown
): Promise<ContainerFetcher | null> {
  const binding = resolveContainerBinding(env);

  if (!binding) {
    return null;
  }

  const containers = createContainerFetchers(binding);

  for (let attempt = 0; attempt < CONTAINER_HEALTH_ATTEMPTS; attempt += 1) {
    const healthyContainer = await findHealthyContainer(containers);

    if (healthyContainer) {
      return healthyContainer;
    }

    if (attempt < CONTAINER_HEALTH_ATTEMPTS - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, CONTAINER_HEALTH_RETRY_DELAY_MS)
      );
    }
  }

  return containers[0] ?? null;
}

function resolveNodeEnv(env: unknown): Record<string, string> {
  // Forward NODE_ENV from the worker env (set by wrangler `vars`) to the
  // container. This is the single switch the Python runtime reads to
  // decide whether the dev-only escape hatches (pixel fallback, face
  // match skip, rich debug responses) are enabled. Production wrangler
  // sets NODE_ENV=production; dev sets NODE_ENV=development; missing on
  // the worker side defaults to production in the container (fail
  // secure).
  const value = isObjectRecord(env) ? Reflect.get(env, "NODE_ENV") : undefined;

  return typeof value === "string" && value.length > 0
    ? { NODE_ENV: value }
    : { NODE_ENV: "production" };
}

function resolveDebugMetrics(env: unknown): Record<string, string> {
  // Bench envs set BIOMETRIC_VERIFIER_DEBUG_METRICS=1 in the worker
  // `vars`; that needs to land inside the container too so service.py
  // unlocks /_debug/metrics. Production keeps it unset → 404.
  const value = isObjectRecord(env)
    ? Reflect.get(env, "BIOMETRIC_VERIFIER_DEBUG_METRICS")
    : undefined;

  return typeof value === "string" && value === "1"
    ? { BIOMETRIC_VERIFIER_DEBUG_METRICS: "1" }
    : {};
}

function forwardStringEnv(env: unknown, key: string): Record<string, string> {
  const value = isObjectRecord(env) ? Reflect.get(env, key) : undefined;
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

// Container keep-alive after the last request. Memory + disk are
// billed continuously while the container is "running", regardless of
// CPU activity — so this window is a pure cost lever for sporadic
// traffic. With the prewarm trigger in place (fires when a session
// enters liveness_capturing), back-to-back users get parallel
// cold-boot during their recording window, so sleepAfter no longer
// shields against user-visible cold starts. 30s captures truly
// clustered traffic (sub-half-minute gaps) without paying the idle
// memory+disk bill on every wake. Override per-env via the
// BIOMETRIC_VERIFIER_SLEEP_AFTER wrangler var if a workload needs
// shorter (`10s` for one-shot tests) or longer (`5m` for steady).
const DEFAULT_SLEEP_AFTER = "30s";

function resolveSleepAfter(env: unknown): string {
  const value = isObjectRecord(env)
    ? Reflect.get(env, "BIOMETRIC_VERIFIER_SLEEP_AFTER")
    : undefined;
  return typeof value === "string" && value.length > 0
    ? value
    : DEFAULT_SLEEP_AFTER;
}

export class BiometricVerifierContainer extends Container<BiometricVerifierBindings> {
  defaultPort = 8080;
  sleepAfter = resolveSleepAfter(this.env);
  envVars = {
    BIOMETRIC_VERIFIER_DETECTOR_PATH,
    BIOMETRIC_VERIFIER_MODEL_PATH,
    BIOMETRIC_VERIFIER_MESH_MODEL_PATH,
    PORT: "8080",
    ...resolveNodeEnv(this.env),
    ...resolveDebugMetrics(this.env),
    ...forwardStringEnv(this.env, "BIOMETRIC_VERIFIER_ONNX_INTRA_OP_THREADS"),
    ...forwardStringEnv(this.env, "BIOMETRIC_VERIFIER_ONNX_INTER_OP_THREADS"),
    ...forwardStringEnv(this.env, "BIOMETRIC_VERIFIER_FRAME_PARALLEL_WORKERS"),
    ...forwardStringEnv(this.env, "BIOMETRIC_VERIFIER_PREWARM"),
    ...forwardStringEnv(this.env, "OMP_NUM_THREADS"),
    ...forwardStringEnv(this.env, "MKL_NUM_THREADS"),
    ...forwardStringEnv(this.env, "OPENBLAS_NUM_THREADS"),
  };
}

const worker = createBiometricVerifierWorker({
  getContainer: getContainerInstance,
});

export default worker;
