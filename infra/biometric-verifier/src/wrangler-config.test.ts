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
  test("dev/test env enables the pixel-correlation fallback", async () => {
    const config = await loadBiometricVerifierWranglerConfig();

    expect(config.vars?.BIOMETRIC_VERIFIER_ALLOW_PIXEL_FALLBACK).toBe("1");
  });

  test("production env does not enable the pixel-correlation fallback", async () => {
    const config = await loadBiometricVerifierWranglerConfig();

    // Top-level `vars` are NOT inherited by named envs in wrangler. The
    // production block must therefore be checked on its own — anything other
    // than `undefined` here means the test-only escape hatch could ship.
    expect(
      config.env?.production?.vars?.BIOMETRIC_VERIFIER_ALLOW_PIXEL_FALLBACK
    ).toBeUndefined();
  });
});
