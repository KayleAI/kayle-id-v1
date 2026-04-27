/**
 * Fails fast if the Apple Developer team has a pending Apple Developer Program
 * License Agreement (or any other agreement) that must be signed before App
 * Store Connect calls succeed.
 *
 * Apple's API surfaces agreement state on every authenticated call: when a
 * required agreement is unsigned, requests against `/v1/profiles` (the same
 * endpoint apple-actions/download-provisioning-profiles uses later in the
 * release workflow) return HTTP 403 with an `errors[].detail` mentioning
 * "agreement". We probe that endpoint here so the failure happens in seconds
 * on a Linux runner, before any macOS minutes are spent on archive/export.
 *
 * Required env vars:
 *   APP_STORE_CONNECT_ISSUER_ID    UUID issuer id from App Store Connect
 *   APP_STORE_CONNECT_KEY_ID       short key id (e.g. "1A2B3C4D5E")
 *   APP_STORE_CONNECT_PRIVATE_KEY  PEM-encoded .p8 private key contents
 *
 * Optional env vars (for tests):
 *   APP_STORE_CONNECT_BASE_URL     defaults to https://api.appstoreconnect.apple.com
 */

const AGREEMENTS_URL = "https://appstoreconnect.apple.com/agreements";
const DEFAULT_BASE_URL = "https://api.appstoreconnect.apple.com";
const JWT_LIFETIME_SECONDS = 19 * 60;
const BASE64_PLUS_REGEX = /\+/g;
const BASE64_SLASH_REGEX = /\//g;
const BASE64_TRAILING_PADDING_REGEX = /=+$/;

interface AppleErrorPayload {
  errors?: Array<{
    code?: string;
    detail?: string;
    status?: string;
    title?: string;
  }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}.`);
  }
  return value;
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(BASE64_PLUS_REGEX, "-")
    .replace(BASE64_SLASH_REGEX, "_")
    .replace(BASE64_TRAILING_PADDING_REGEX, "");
}

function pemToPkcs8Bytes(pem: string): Uint8Array {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  if (stripped.length === 0) {
    throw new Error(
      "APP_STORE_CONNECT_PRIVATE_KEY did not contain any base64-encoded key material."
    );
  }

  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function signAppStoreConnectJwt(input: {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
}): Promise<string> {
  const header = { alg: "ES256", kid: input.keyId, typ: "JWT" };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "appstoreconnect-v1",
    exp: issuedAt + JWT_LIFETIME_SECONDS,
    iat: issuedAt,
    iss: input.issuerId,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Bytes(input.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function findAgreementError(
  payload: AppleErrorPayload
): { code?: string; detail: string; title?: string } | null {
  if (!Array.isArray(payload.errors)) {
    return null;
  }

  for (const error of payload.errors) {
    const haystack = `${error.detail ?? ""} ${error.title ?? ""}`.toLowerCase();
    if (haystack.includes("agreement")) {
      return {
        code: error.code,
        detail: error.detail ?? error.title ?? "Pending App Store agreement.",
        title: error.title,
      };
    }
  }

  return null;
}

export type GuardOutcome =
  | { kind: "ok" }
  | { kind: "agreement_pending"; detail: string; status: number }
  | { kind: "request_failed"; detail: string; status: number };

export async function checkAppStoreAgreements(env: {
  APP_STORE_CONNECT_ISSUER_ID?: string;
  APP_STORE_CONNECT_KEY_ID?: string;
  APP_STORE_CONNECT_PRIVATE_KEY?: string;
  APP_STORE_CONNECT_BASE_URL?: string;
}): Promise<GuardOutcome> {
  const issuerId =
    env.APP_STORE_CONNECT_ISSUER_ID ??
    requireEnv("APP_STORE_CONNECT_ISSUER_ID");
  const keyId =
    env.APP_STORE_CONNECT_KEY_ID ?? requireEnv("APP_STORE_CONNECT_KEY_ID");
  const privateKey =
    env.APP_STORE_CONNECT_PRIVATE_KEY ??
    requireEnv("APP_STORE_CONNECT_PRIVATE_KEY");
  const baseUrl =
    env.APP_STORE_CONNECT_BASE_URL ??
    process.env.APP_STORE_CONNECT_BASE_URL ??
    DEFAULT_BASE_URL;

  const token = await signAppStoreConnectJwt({
    issuerId,
    keyId,
    privateKeyPem: privateKey,
  });

  const response = await fetch(`${baseUrl}/v1/profiles?limit=1`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.ok) {
    return { kind: "ok" };
  }

  const rawBody = await response.text();
  let parsed: AppleErrorPayload | null = null;
  try {
    parsed = rawBody ? (JSON.parse(rawBody) as AppleErrorPayload) : null;
  } catch {
    parsed = null;
  }

  if (parsed) {
    const agreementError = findAgreementError(parsed);
    if (agreementError) {
      return {
        detail: agreementError.detail,
        kind: "agreement_pending",
        status: response.status,
      };
    }
  }

  return {
    detail: rawBody || `${response.status} ${response.statusText}`,
    kind: "request_failed",
    status: response.status,
  };
}

async function main(): Promise<void> {
  const outcome = await checkAppStoreAgreements({});

  if (outcome.kind === "ok") {
    console.log(
      "App Store Connect API responded successfully — no pending agreements detected."
    );
    return;
  }

  if (outcome.kind === "agreement_pending") {
    console.error(
      `App Store Connect rejected the request because of a pending agreement (HTTP ${outcome.status}):\n  ${outcome.detail}\n\nSign the outstanding agreement(s) at ${AGREEMENTS_URL} and re-run the release.`
    );
    process.exit(1);
  }

  console.error(
    `App Store Connect request failed with HTTP ${outcome.status}.\nResponse body:\n${outcome.detail}`
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
