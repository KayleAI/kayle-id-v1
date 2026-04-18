import { afterEach, describe, expect, test } from "bun:test";
import {
  clearPkdTrustBundleCache,
  configurePkdTrustBundleLoader,
  configurePkdTrustBundleLoaderFromEnv,
  loadPkdTrustBundle,
  pkdTrustBundleDscSegmentKey,
  pkdTrustBundleKey,
  resolvePkdDscCertificate,
  resolvePkdDscCertificatesBySki,
} from "@/v1/verify/pkd-trust";
import { createPassiveAuthTestChain } from "../helpers/verify-artifacts";

afterEach(() => {
  Date.now = originalDateNow;
  configurePkdTrustBundleLoader(null);
  clearPkdTrustBundleCache();
});

const originalDateNow = Date.now;

describe("PKD trust bundle loader", () => {
  test.serial(
    "verify-artifacts does not configure a trust bundle loader unless one is set explicitly",
    async () => {
      const chain = await createPassiveAuthTestChain();

      expect(chain.trustBundle.raw.counts.dscs).toBe(1);
      expect(await loadPkdTrustBundle()).toBeNull();
    }
  );

  test.serial("loads the trust bundle from R2 when available", async () => {
    const chain = await createPassiveAuthTestChain();
    const responseBytes = new TextEncoder().encode(
      JSON.stringify(chain.trustBundle.raw)
    );
    let requestedKey = "";

    configurePkdTrustBundleLoaderFromEnv({
      STORAGE: {
        get: (key: string) => {
          requestedKey = key;

          return Promise.resolve({
            arrayBuffer: () => Promise.resolve(responseBytes.slice().buffer),
            httpEtag: "test-r2-etag",
          });
        },
      },
    });

    const loaded = await loadPkdTrustBundle();

    expect(requestedKey).toBe(pkdTrustBundleKey());
    expect(loaded?.raw.counts).toEqual(chain.trustBundle.raw.counts);
    expect(loaded?.raw.generatedAt).toBe(chain.trustBundle.raw.generatedAt);
  });

  test.serial(
    "loads DSC segments lazily from R2 when bundle fallback needs them",
    async () => {
      const chain = await createPassiveAuthTestChain();
      const [dscRecord] = chain.trustBundle.raw.dscs;

      expect(dscRecord?.skiHex).not.toBeNull();

      const manifestBytes = new TextEncoder().encode(
        JSON.stringify({
          ...chain.trustBundle.raw,
          dscSegmentIndex: {
            issuerSerial: {
              [`${dscRecord?.issuerKey}:${dscRecord?.serialNumberHex.toLowerCase()}`]:
                ["UT"],
            },
            skiHex: {
              [dscRecord?.skiHex ?? ""]: ["UT"],
            },
          },
          dscs: [],
        })
      );
      const segmentBytes = new TextEncoder().encode(
        JSON.stringify({
          dscs: chain.trustBundle.raw.dscs,
          segmentKey: "UT",
          version: chain.trustBundle.raw.version,
        })
      );
      const requestedKeys: string[] = [];

      configurePkdTrustBundleLoaderFromEnv({
        STORAGE: {
          get: (key: string) => {
            requestedKeys.push(key);

            if (key === pkdTrustBundleKey()) {
              return Promise.resolve({
                arrayBuffer: () => Promise.resolve(manifestBytes.slice().buffer),
                httpEtag: "manifest-etag",
              });
            }

            if (key === pkdTrustBundleDscSegmentKey("UT")) {
              return Promise.resolve({
                arrayBuffer: () => Promise.resolve(segmentBytes.slice().buffer),
                httpEtag: "segment-etag",
              });
            }

            return Promise.resolve(null);
          },
        },
      });

      const loaded = await loadPkdTrustBundle();

      expect(loaded).not.toBeNull();
      expect(requestedKeys).toEqual([pkdTrustBundleKey()]);

      const resolvedByIssuerSerial = await resolvePkdDscCertificate(
        loaded!,
        dscRecord?.issuerKey ?? "",
        dscRecord?.serialNumberHex ?? ""
      );
      const resolvedBySki = await resolvePkdDscCertificatesBySki(
        loaded!,
        dscRecord?.skiHex ?? ""
      );

      expect(resolvedByIssuerSerial?.record.derBase64).toBe(dscRecord?.derBase64);
      expect(resolvedBySki.map((entry) => entry.record.derBase64)).toEqual([
        dscRecord?.derBase64,
      ]);
      expect(requestedKeys).toEqual([
        pkdTrustBundleKey(),
        pkdTrustBundleDscSegmentKey("UT"),
      ]);
    }
  );

  test.serial(
    "loads the trust bundle from inline env JSON before consulting R2",
    async () => {
      const chain = await createPassiveAuthTestChain();
      let requestedKey = "";

      configurePkdTrustBundleLoaderFromEnv({
        STORAGE: {
          get: (key: string) => {
            requestedKey = key;
            return Promise.resolve(null);
          },
        },
        VERIFY_PKD_TRUST_BUNDLE_JSON: JSON.stringify(chain.trustBundle.raw),
      });

      const loaded = await loadPkdTrustBundle();

      expect(requestedKey).toBe("");
      expect(loaded?.raw.counts).toEqual(chain.trustBundle.raw.counts);
      expect(loaded?.raw.generatedAt).toBe(chain.trustBundle.raw.generatedAt);
    }
  );

  test.serial(
    "fails closed when the R2 trust bundle disappears after cache expiry",
    async () => {
      const chain = await createPassiveAuthTestChain();
      const responseBytes = new TextEncoder().encode(
        JSON.stringify(chain.trustBundle.raw)
      );
      let now = 1000;
      let getCalls = 0;

      Date.now = () => now;

      configurePkdTrustBundleLoaderFromEnv({
        STORAGE: {
          get: () => {
            getCalls += 1;

            if (getCalls === 1) {
              return Promise.resolve({
                arrayBuffer: () =>
                  Promise.resolve(responseBytes.slice().buffer),
                httpEtag: "test-r2-etag",
              });
            }

            return Promise.resolve(null);
          },
        },
      });

      const firstLoad = await loadPkdTrustBundle();
      now += 5 * 60 * 1000 + 1;
      const secondLoad = await loadPkdTrustBundle();

      expect(firstLoad?.raw.counts).toEqual(chain.trustBundle.raw.counts);
      expect(secondLoad).toBeNull();
      expect(getCalls).toBe(2);
    }
  );
});
