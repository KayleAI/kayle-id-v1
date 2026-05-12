import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const SHA256_DIGEST = /sha256:[a-f0-9]{64}/;
const COMMIT_SHA = /OPENCV_ZOO_COMMIT="[a-f0-9]{40}"/;
const MODEL_SHA = /MODEL_SHA256="[a-f0-9]{64}"/g;

async function readProjectFile(relativePath: string): Promise<string> {
  return await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("biometric-verifier supply chain pins", () => {
  test("pins the Docker base image to an immutable digest", async () => {
    const dockerfile = await readProjectFile("Dockerfile");
    const fromLine = dockerfile
      .split("\n")
      .find((line) => line.startsWith("FROM "));

    expect(fromLine).toBeDefined();
    expect(fromLine).toContain("@sha256:");
    expect(fromLine).toMatch(SHA256_DIGEST);
  });

  test("downloads ONNX models from a fixed commit with checksums", async () => {
    const script = await readProjectFile("scripts/download-models.sh");

    expect(script).not.toContain("/raw/main/");
    expect(script).toMatch(COMMIT_SHA);
    expect(Array.from(script.matchAll(MODEL_SHA))).toHaveLength(2);
    expect(script).toContain("verify_checksum");
  });
});
