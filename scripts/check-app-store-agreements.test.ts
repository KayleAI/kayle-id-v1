import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type Server, serve } from "bun";
import { checkAppStoreAgreements } from "./check-app-store-agreements";

const BEARER_PREFIX_REGEX = /^Bearer /;
const AGREEMENT_DETAIL_REGEX = /agreement/i;

let stubServer: Server | null = null;

function pemFromPkcs8(bytes: ArrayBuffer): string {
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

let privateKeyPem = "";

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

function startStub(
  handler: (request: Request) => Response | Promise<Response>
) {
  stubServer = serve({ fetch: handler, port: 0 });
  return `http://localhost:${stubServer.port}`;
}

describe("checkAppStoreAgreements", () => {
  test("returns ok when App Store Connect responds 200", async () => {
    const baseUrl = startStub((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/profiles");
      expect(request.headers.get("Authorization")).toMatch(BEARER_PREFIX_REGEX);
      return Response.json({ data: [] });
    });

    const outcome = await checkAppStoreAgreements({
      APP_STORE_CONNECT_BASE_URL: baseUrl,
      APP_STORE_CONNECT_ISSUER_ID: "issuer-id",
      APP_STORE_CONNECT_KEY_ID: "KEY1234567",
      APP_STORE_CONNECT_PRIVATE_KEY: privateKeyPem,
    });

    expect(outcome.kind).toBe("ok");
  });

  test("flags pending agreements when error detail mentions an agreement", async () => {
    const baseUrl = startStub(
      () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                code: "FORBIDDEN_ERROR",
                detail:
                  "You have not accepted the latest Apple Developer Program License Agreement.",
                status: "403",
                title: "There were errors in the data supplied.",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 403 }
        )
    );

    const outcome = await checkAppStoreAgreements({
      APP_STORE_CONNECT_BASE_URL: baseUrl,
      APP_STORE_CONNECT_ISSUER_ID: "issuer-id",
      APP_STORE_CONNECT_KEY_ID: "KEY1234567",
      APP_STORE_CONNECT_PRIVATE_KEY: privateKeyPem,
    });

    expect(outcome.kind).toBe("agreement_pending");
    if (outcome.kind === "agreement_pending") {
      expect(outcome.status).toBe(403);
      expect(outcome.detail).toMatch(AGREEMENT_DETAIL_REGEX);
    }
  });

  test("returns request_failed for non-agreement 4xx/5xx responses", async () => {
    const baseUrl = startStub(
      () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                code: "NOT_AUTHORIZED",
                detail: "The provided token is invalid.",
                status: "401",
                title: "Authentication credentials are missing or invalid.",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 401 }
        )
    );

    const outcome = await checkAppStoreAgreements({
      APP_STORE_CONNECT_BASE_URL: baseUrl,
      APP_STORE_CONNECT_ISSUER_ID: "issuer-id",
      APP_STORE_CONNECT_KEY_ID: "KEY1234567",
      APP_STORE_CONNECT_PRIVATE_KEY: privateKeyPem,
    });

    expect(outcome.kind).toBe("request_failed");
    if (outcome.kind === "request_failed") {
      expect(outcome.status).toBe(401);
      expect(outcome.detail).toContain("NOT_AUTHORIZED");
    }
  });

  test("returns request_failed when the body is empty", async () => {
    const baseUrl = startStub(
      () =>
        new Response("", { status: 500, statusText: "Internal Server Error" })
    );

    const outcome = await checkAppStoreAgreements({
      APP_STORE_CONNECT_BASE_URL: baseUrl,
      APP_STORE_CONNECT_ISSUER_ID: "issuer-id",
      APP_STORE_CONNECT_KEY_ID: "KEY1234567",
      APP_STORE_CONNECT_PRIVATE_KEY: privateKeyPem,
    });

    expect(outcome.kind).toBe("request_failed");
    if (outcome.kind === "request_failed") {
      expect(outcome.status).toBe(500);
      expect(outcome.detail).toContain("500");
    }
  });
});
