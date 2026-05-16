export const DEFAULT_APP_STORE_CONNECT_BASE_URL =
  "https://api.appstoreconnect.apple.com";

const JWT_LIFETIME_SECONDS = 19 * 60;
const BASE64_PLUS_REGEX = /\+/g;
const BASE64_SLASH_REGEX = /\//g;
const BASE64_TRAILING_PADDING_REGEX = /=+$/;

export interface AppStoreConnectEnv {
  APP_STORE_CONNECT_BASE_URL?: string;
  APP_STORE_CONNECT_ISSUER_ID?: string;
  APP_STORE_CONNECT_KEY_ID?: string;
  APP_STORE_CONNECT_PRIVATE_KEY?: string;
}

export interface AppStoreConnectConfig {
  baseUrl: string;
  issuerId: string;
  keyId: string;
  privateKey: string;
}

export interface AppleErrorPayload {
  errors?: Array<{
    code?: string;
    detail?: string;
    status?: string;
    title?: string;
  }>;
}

export class AppStoreConnectRequestError extends Error {
  readonly detail: string;
  readonly status: number;

  constructor(message: string, status: number, detail: string) {
    super(message);
    this.name = "AppStoreConnectRequestError";
    this.status = status;
    this.detail = detail;
  }
}

function requireEnv(env: AppStoreConnectEnv, name: keyof AppStoreConnectEnv) {
  const value = env[name] ?? process.env[name];
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

export function readAppStoreConnectConfig(
  env: AppStoreConnectEnv
): AppStoreConnectConfig {
  return {
    baseUrl:
      env.APP_STORE_CONNECT_BASE_URL ?? DEFAULT_APP_STORE_CONNECT_BASE_URL,
    issuerId: requireEnv(env, "APP_STORE_CONNECT_ISSUER_ID"),
    keyId: requireEnv(env, "APP_STORE_CONNECT_KEY_ID"),
    privateKey: requireEnv(env, "APP_STORE_CONNECT_PRIVATE_KEY"),
  };
}

export async function createAppStoreConnectJwt(input: {
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

export async function fetchAppStoreConnectJson<T>(
  config: AppStoreConnectConfig,
  path: string
): Promise<T> {
  const token = await createAppStoreConnectJwt({
    issuerId: config.issuerId,
    keyId: config.keyId,
    privateKeyPem: config.privateKey,
  });

  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new AppStoreConnectRequestError(
      `App Store Connect request failed with HTTP ${response.status}.`,
      response.status,
      rawBody || `${response.status} ${response.statusText}`
    );
  }

  return (rawBody ? JSON.parse(rawBody) : {}) as T;
}

export function parseAppleErrorPayload(
  rawBody: string
): AppleErrorPayload | null {
  try {
    return rawBody ? (JSON.parse(rawBody) as AppleErrorPayload) : null;
  } catch {
    return null;
  }
}
