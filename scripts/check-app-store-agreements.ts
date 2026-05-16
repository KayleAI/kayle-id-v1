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
 * Optional checkAppStoreAgreements() parameter (for tests):
 *   APP_STORE_CONNECT_BASE_URL     defaults to https://api.appstoreconnect.apple.com
 */

import {
  type AppleErrorPayload,
  type AppStoreConnectEnv,
  AppStoreConnectRequestError,
  fetchAppStoreConnectJson,
  parseAppleErrorPayload,
  readAppStoreConnectConfig,
} from "./app-store-connect";

const AGREEMENTS_URL = "https://appstoreconnect.apple.com/agreements";

function findAgreementError(
  payload: AppleErrorPayload | null
): { code?: string; detail: string; title?: string } | null {
  if (!(payload && Array.isArray(payload.errors))) {
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

export async function checkAppStoreAgreements(
  env: AppStoreConnectEnv
): Promise<GuardOutcome> {
  const config = readAppStoreConnectConfig(env);

  try {
    await fetchAppStoreConnectJson<unknown>(config, "/v1/profiles?limit=1");
    return { kind: "ok" };
  } catch (error) {
    if (!(error instanceof AppStoreConnectRequestError)) {
      throw error;
    }

    const parsed = parseAppleErrorPayload(error.detail);
    const agreementError = findAgreementError(parsed);
    if (agreementError) {
      return {
        detail: agreementError.detail,
        kind: "agreement_pending",
        status: error.status,
      };
    }

    return {
      detail: error.detail,
      kind: "request_failed",
      status: error.status,
    };
  }
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
