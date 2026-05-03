/**
 * Regenerate the committed passive-auth fixture chain.
 *
 * The integration tests in `apps/api/tests/verify.test.ts` go through the WS
 * pipeline against a separate API-server process. For PA to succeed end to end
 * the test process and the API server must agree on a CSCA — but each call to
 * `createPassiveAuthTestChain` produces fresh random keys, so dynamic
 * generation in two processes can't share a chain. We therefore commit a fixed
 * chain (CSCA, DSC, CRL, bundle JSON) and wire both sides to it.
 *
 * Run when the fixtures need to be rolled (e.g. you want to bump validity
 * dates further into the future):
 *
 *   cd apps/api && bun run tests/fixtures/passive-auth/regenerate.ts
 *
 * The keys committed here are TEST ONLY — they have no production scope and
 * sit alongside other test fixtures in source control.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createPassiveAuthTestChain } from "../../helpers/verify-artifacts";

// Cap the upper bound at 2049 — pkijs encodes `Time` as UTCTime, which only
// represents years 1950-2049. 2050+ wraps and the cert appears already-expired.
const FIXED_NOT_BEFORE = new Date("2024-01-01T00:00:00.000Z");
const FIXED_NOT_AFTER = new Date("2049-12-31T00:00:00.000Z");

const fixturesDir = new URL("./", import.meta.url).pathname;

function pemEncode(label: string, der: Uint8Array): string {
	const base64 = Buffer.from(der).toString("base64");
	const lines = base64.match(/.{1,64}/gu) ?? [];
	return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
	const pkcs8 = (await crypto.subtle.exportKey("pkcs8", key)) as ArrayBuffer;
	return pemEncode("PRIVATE KEY", new Uint8Array(pkcs8));
}

const chain = await createPassiveAuthTestChain({
	cscaNotAfter: FIXED_NOT_AFTER,
	cscaNotBefore: FIXED_NOT_BEFORE,
	crlNextUpdate: FIXED_NOT_AFTER,
	crlThisUpdate: FIXED_NOT_BEFORE,
	dscNotAfter: FIXED_NOT_AFTER,
	dscNotBefore: FIXED_NOT_BEFORE,
});

const cscaCertPem = pemEncode("CERTIFICATE", chain.csca.derBytes);
const cscaKeyPem = await exportPrivateKeyPem(chain.csca.keyPair.privateKey);
const dscCertPem = pemEncode("CERTIFICATE", chain.dsc.derBytes);
const dscKeyPem = await exportPrivateKeyPem(chain.dsc.keyPair.privateKey);

const crlEntry = chain.trustBundle.raw.crls[0];
if (!crlEntry) {
	throw new Error("regenerate_crl_missing");
}
const crlDer = Uint8Array.from(Buffer.from(crlEntry.derBase64, "base64"));
const crlPem = pemEncode("X509 CRL", crlDer);

const bundleJson = `${JSON.stringify(chain.trustBundle.raw, null, 2)}\n`;
const bundleJsonInline = JSON.stringify(chain.trustBundle.raw);

if (bundleJsonInline.includes("'")) {
	throw new Error("regenerate_bundle_contains_unsupported_quote");
}

await writeFile(path.join(fixturesDir, "csca.pem"), cscaCertPem);
await writeFile(path.join(fixturesDir, "csca-key.pem"), cscaKeyPem);
await writeFile(path.join(fixturesDir, "dsc.pem"), dscCertPem);
await writeFile(path.join(fixturesDir, "dsc-key.pem"), dscKeyPem);
await writeFile(path.join(fixturesDir, "crl.pem"), crlPem);
await writeFile(path.join(fixturesDir, "trust-bundle.json"), bundleJson);
await writeFile(
	path.join(fixturesDir, "trust-bundle.env.txt"),
	`VERIFY_PKD_TRUST_BUNDLE_JSON='${bundleJsonInline}'\n`,
);

const csca = chain.trustBundle.raw.cscas[0];
const dsc = chain.trustBundle.raw.dscs[0];
console.log("Fixtures regenerated:");
console.log(`  CSCA SKI: ${csca?.skiHex ?? "n/a"}`);
console.log(`  DSC SKI: ${dsc?.skiHex ?? "n/a"}`);
console.log(`  CSCA serial: ${csca?.serialNumberHex ?? "n/a"}`);
console.log(`  DSC serial: ${dsc?.serialNumberHex ?? "n/a"}`);
console.log(`  notBefore: ${FIXED_NOT_BEFORE.toISOString()}`);
console.log(`  notAfter:  ${FIXED_NOT_AFTER.toISOString()}`);
console.log("");
console.log(
	"Append the contents of trust-bundle.env.txt to .env.test.example and",
);
console.log("commit the regenerated PEM/JSON fixtures.");
