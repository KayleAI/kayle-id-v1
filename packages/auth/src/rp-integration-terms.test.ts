import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  RP_INTEGRATION_TERMS_CANONICAL_TEXT,
  RP_INTEGRATION_TERMS_HASH,
  RP_INTEGRATION_TERMS_JURISDICTION,
  RP_INTEGRATION_TERMS_VERSION,
} from "./rp-integration-terms";

test("current Kayle ID Integration Terms hash matches the canonical terms text", () => {
  const hash = createHash("sha256")
    .update(RP_INTEGRATION_TERMS_CANONICAL_TEXT, "utf8")
    .digest("hex");

  expect(String(RP_INTEGRATION_TERMS_HASH)).toBe(`sha256:${hash}`);
  expect(RP_INTEGRATION_TERMS_VERSION).toBe("2026-05-17");
  expect(RP_INTEGRATION_TERMS_JURISDICTION).toBe("UK/EU GDPR");
});
