import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type Server, serve } from "bun";
import { resolveIosBuildNumber } from "./resolve-ios-build-number";

const BEARER_PREFIX_REGEX = /^Bearer /;

let stubServer: Server | null = null;
let privateKeyPem = "";

function pemFromPkcs8(bytes: ArrayBuffer): string {
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const exported = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  privateKeyPem = pemFromPkcs8(exported);
});

afterEach(() => {
  stubServer?.stop();
  stubServer = null;
});

function appStoreEnv(baseUrl: string) {
  return {
    APP_BUNDLE_ID: "kayle.id",
    APP_STORE_CONNECT_BASE_URL: baseUrl,
    APP_STORE_CONNECT_ISSUER_ID: "issuer-id",
    APP_STORE_CONNECT_KEY_ID: "KEY1234567",
    APP_STORE_CONNECT_PRIVATE_KEY: privateKeyPem,
    APP_VERSION: "1.5.0",
  };
}

function json(data: unknown) {
  return Response.json(data);
}

function startStub(
  handler: (request: Request) => Response | Promise<Response>
) {
  stubServer = serve({ fetch: handler, port: 0 });
  return `http://localhost:${stubServer.port}`;
}

describe("resolveIosBuildNumber", () => {
  test("returns build 1 when the prerelease version does not exist yet", async () => {
    const baseUrl = startStub((request) => {
      const url = new URL(request.url);
      expect(request.headers.get("Authorization")).toMatch(BEARER_PREFIX_REGEX);

      if (url.pathname === "/v1/apps") {
        expect(url.searchParams.get("filter[bundleId]")).toBe("kayle.id");
        return json({ data: [{ id: "app-id", type: "apps" }] });
      }

      if (url.pathname === "/v1/apps/app-id/preReleaseVersions") {
        return json({ data: [] });
      }

      throw new Error(`Unexpected request ${url.pathname}`);
    });

    const resolution = await resolveIosBuildNumber(appStoreEnv(baseUrl));

    expect(resolution.buildNumber).toBe(1);
    expect(resolution.bundleVersion).toBe("1.5.0.1");
    expect(resolution.latestBundleVersion).toBeNull();
  });

  test("increments the highest uploaded build for the matching app version", async () => {
    const baseUrl = startStub((request) => {
      const url = new URL(request.url);
      expect(request.headers.get("Authorization")).toMatch(BEARER_PREFIX_REGEX);

      if (url.pathname === "/v1/apps") {
        return json({ data: [{ id: "app-id", type: "apps" }] });
      }

      if (url.pathname === "/v1/apps/app-id/preReleaseVersions") {
        return json({
          data: [
            {
              attributes: { platform: "IOS", version: "1.5.0" },
              id: "prerelease-id",
              type: "preReleaseVersions",
            },
          ],
        });
      }

      if (url.pathname === "/v1/preReleaseVersions/prerelease-id/builds") {
        return json({
          data: [
            { attributes: { version: "1.5.0.1" }, id: "build-1" },
            { attributes: { version: "1.5.0.2" }, id: "build-2" },
          ],
        });
      }

      throw new Error(`Unexpected request ${url.pathname}`);
    });

    const resolution = await resolveIosBuildNumber(appStoreEnv(baseUrl));

    expect(resolution.buildNumber).toBe(3);
    expect(resolution.bundleVersion).toBe("1.5.0.3");
    expect(resolution.latestBundleVersion).toBe("1.5.0.2");
  });

  test("follows App Store Connect pagination", async () => {
    const baseUrl = startStub((request) => {
      const url = new URL(request.url);

      if (url.pathname === "/v1/apps") {
        return json({ data: [{ id: "app-id", type: "apps" }] });
      }

      if (url.pathname === "/v1/apps/app-id/preReleaseVersions") {
        return json({
          data: [
            {
              attributes: { platform: "IOS", version: "1.5.0" },
              id: "prerelease-id",
              type: "preReleaseVersions",
            },
          ],
        });
      }

      if (
        url.pathname === "/v1/preReleaseVersions/prerelease-id/builds" &&
        !url.searchParams.has("page")
      ) {
        return json({
          data: [{ attributes: { version: "1.5.0.1" }, id: "build-1" }],
          links: {
            next: `${baseUrl}/v1/preReleaseVersions/prerelease-id/builds?page=2`,
          },
        });
      }

      if (
        url.pathname === "/v1/preReleaseVersions/prerelease-id/builds" &&
        url.searchParams.get("page") === "2"
      ) {
        return json({
          data: [{ attributes: { version: "1.5.0.2" }, id: "build-2" }],
        });
      }

      throw new Error(`Unexpected request ${url.pathname}`);
    });

    const resolution = await resolveIosBuildNumber(appStoreEnv(baseUrl));

    expect(resolution.buildNumber).toBe(3);
    expect(resolution.bundleVersion).toBe("1.5.0.3");
  });

  test("fails closed when existing build versions do not match the expected shape", async () => {
    const baseUrl = startStub((request) => {
      const url = new URL(request.url);

      if (url.pathname === "/v1/apps") {
        return json({ data: [{ id: "app-id", type: "apps" }] });
      }

      if (url.pathname === "/v1/apps/app-id/preReleaseVersions") {
        return json({
          data: [
            {
              attributes: { platform: "IOS", version: "1.5.0" },
              id: "prerelease-id",
              type: "preReleaseVersions",
            },
          ],
        });
      }

      if (url.pathname === "/v1/preReleaseVersions/prerelease-id/builds") {
        return json({
          data: [{ attributes: { version: "42" }, id: "build-1" }],
        });
      }

      throw new Error(`Unexpected request ${url.pathname}`);
    });

    await expect(resolveIosBuildNumber(appStoreEnv(baseUrl))).rejects.toThrow(
      "Expected existing CFBundleVersion values like 1.5.0.N"
    );
  });
});
