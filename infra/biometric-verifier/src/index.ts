import { Container } from "@cloudflare/containers";
import type { ContainerFetcher } from "./worker";
import {
  BIOMETRIC_VERIFIER_DETECTOR_PATH,
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

function resolvePixelFallbackEnv(env: unknown): Record<string, string> {
  // Forward the test-only fallback flag to the container only when the worker
  // env explicitly sets it to "1". Production wrangler config does not set
  // this binding, so the container always runs without the fallback.
  const value = isObjectRecord(env)
    ? Reflect.get(env, "BIOMETRIC_VERIFIER_ALLOW_PIXEL_FALLBACK")
    : undefined;

  return value === "1" ? { BIOMETRIC_VERIFIER_ALLOW_PIXEL_FALLBACK: "1" } : {};
}

export class BiometricVerifierContainer extends Container<BiometricVerifierBindings> {
  defaultPort = 8080;
  sleepAfter = "10m";
  envVars = {
    BIOMETRIC_VERIFIER_DETECTOR_PATH,
    BIOMETRIC_VERIFIER_MODEL_PATH,
    PORT: "8080",
    ...resolvePixelFallbackEnv(this.env),
  };
}

const worker = createBiometricVerifierWorker({
  getContainer: getContainerInstance,
});

export default worker;
