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
    // YuNet + AuraFace + MediaPipe Face Landmarker (mesh) + the two
    // MiniFASNet PAD models (V2 + V1SE) — five total, each pinned
    // by literal sha256 directly in the script. PAD used to be
    // optional (build args), but it's now part of the IDV verdict
    // path so the pins are unconditional.
    expect(Array.from(script.matchAll(MODEL_SHA))).toHaveLength(5);
    expect(script).toContain("verify_checksum");
  });

  test("pins the AuraFace + mesh + PAD models against Kayle's own R2 mirror", async () => {
    const script = await readProjectFile("scripts/download-models.sh");

    // We control models.kayle.ai. Direct upstream fetches (Google
    // CDN, Hugging Face LFS, Minivision GitHub, PINTO0309, etc.)
    // shouldn't appear in the production fetch path — supply-chain
    // provenance lives at the Kayle hop. SFace (the recognizer this
    // replaced) used to come straight from opencv_zoo via
    // raw.githubusercontent.com; AuraFace + PAD ship via R2 instead
    // so we own every binary we deploy.
    expect(script).toContain("https://models.kayle.ai/");
    expect(script).toContain('MESH_MODEL="face_landmarks_detector.onnx"');
    expect(script).toContain('RECOGNIZER_MODEL="auraface_glintr100.onnx"');
    expect(script).toContain('PAD_V2_MODEL="pad_minifasnet_v2_scale27.onnx"');
    expect(script).toContain(
      'PAD_V1SE_MODEL="pad_minifasnet_v1se_scale40.onnx"'
    );
    expect(script).not.toContain("face_recognition_sface");
    expect(script).not.toContain("face_anti_spoofing_minifasnet.onnx");
    expect(script).not.toContain("storage.googleapis.com/mediapipe-models");
    expect(script).not.toContain("huggingface.co/fal");
    expect(script).not.toContain(
      "github.com/minivision-ai/Silent-Face-Anti-Spoofing"
    );
    expect(script).not.toContain("PINTO0309");
  });
});
