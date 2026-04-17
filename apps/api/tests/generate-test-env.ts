import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPassiveAuthTestChain } from "./helpers/verify-artifacts";

const examplePath = fileURLToPath(
  new URL("../../../.env.test.example", import.meta.url).toString()
);
const outputPath = fileURLToPath(
  new URL("../.env.test", import.meta.url).toString()
);

const baseEnv = await readFile(examplePath, "utf8");
const chain = await createPassiveAuthTestChain();
const trustBundleJson = JSON.stringify(chain.trustBundle.raw);

if (trustBundleJson.includes("'")) {
  throw new Error("test_trust_bundle_contains_unsupported_quote");
}

const output = [
  baseEnv.trimEnd(),
  "",
  `VERIFY_PKD_TRUST_BUNDLE_JSON='${trustBundleJson}'`,
  "",
].join("\n");

await writeFile(outputPath, output);
