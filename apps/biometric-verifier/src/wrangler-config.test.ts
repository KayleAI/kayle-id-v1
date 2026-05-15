import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

interface BiometricVerifierWranglerConfig {
  env?: {
    production?: {
      vars?: Record<string, unknown>;
      secrets?: {
        required?: string[];
      };
    };
  };
  vars?: Record<string, unknown>;
}

async function loadBiometricVerifierWranglerConfig(): Promise<BiometricVerifierWranglerConfig> {
  const raw = await readFile(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8"
  );
  return JSON.parse(raw) as BiometricVerifierWranglerConfig;
}

describe("biometric-verifier wrangler config", () => {
  // Dev-only escape hatches (pixel-correlation fallback, face-match-skip
  // debug shortcut, rich debug responses) used to live behind three
  // separate env flags. They've all been collapsed into a single
  // NODE_ENV=development check that the container forwards to its
  // Python runtime via `index.ts`'s `resolveNodeEnv`. The guardrail
  // we still need is the same as before: production must NOT inherit
  // any dev-mode behaviour.
  test("dev env declares NODE_ENV=development", async () => {
    const config = await loadBiometricVerifierWranglerConfig();

    expect(config.vars?.NODE_ENV).toBe("development");
  });

  test("production env declares NODE_ENV=production", async () => {
    const config = await loadBiometricVerifierWranglerConfig();

    // Top-level `vars` are NOT inherited by named envs in wrangler, so
    // the production block must set NODE_ENV=production on its own.
    // Any other value (including undefined) leaves the container
    // running in dev mode against real traffic.
    expect(config.env?.production?.vars?.NODE_ENV).toBe("production");
  });

  test("dev env declares NO legacy ALLOW_* flags", async () => {
    const config = await loadBiometricVerifierWranglerConfig();

    // These were folded into NODE_ENV. Re-introducing either as a vars
    // entry would create two sources of truth for dev-mode behaviour
    // and silently desync wrangler from the Python runtime.
    expect(
      config.vars?.BIOMETRIC_VERIFIER_ALLOW_PIXEL_FALLBACK
    ).toBeUndefined();
    expect(
      config.vars?.BIOMETRIC_VERIFIER_ALLOW_FACE_MATCH_SKIP
    ).toBeUndefined();
  });

  test("production env declares NO legacy ALLOW_* flags either", async () => {
    const config = await loadBiometricVerifierWranglerConfig();

    expect(
      config.env?.production?.vars?.BIOMETRIC_VERIFIER_ALLOW_PIXEL_FALLBACK
    ).toBeUndefined();
    expect(
      config.env?.production?.vars?.BIOMETRIC_VERIFIER_ALLOW_FACE_MATCH_SKIP
    ).toBeUndefined();
  });

  test("neither env disables PAD via the kill switch", async () => {
    // PAD is part of the IDV verdict path now and must default to
    // enabled. `BIOMETRIC_VERIFIER_PAD_DISABLED` is reserved as an
    // emergency kill switch — accidentally committing it to a deploy
    // would silently disable spoof detection. Both envs must omit
    // it (or set it to a value other than "1", which the container
    // treats as "not disabled").
    const config = await loadBiometricVerifierWranglerConfig();

    expect(config.vars?.BIOMETRIC_VERIFIER_PAD_DISABLED).toBeUndefined();
    expect(
      config.env?.production?.vars?.BIOMETRIC_VERIFIER_PAD_DISABLED
    ).toBeUndefined();
  });
});
