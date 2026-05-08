import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { mobile_attest_keys } from "@kayle-id/database/schema/core";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { ApiRequestLogger } from "@/logging";

/**
 * Periodic refresh of Apple's App Attest receipt for each registered key.
 *
 * Apple exposes `https://data.appattest.apple.com/v1/attestationData`. POSTing
 * a receipt there returns a fresher receipt plus a `riskMetric` indicating how
 * many keys this device has minted recently — high values are a soft fraud
 * signal that feeds the per-attempt riskScore. Apple rate-limits at ~1 call
 * per receipt per 24h, so the refresh runs once per day.
 *
 * The handler is deliberately fail-soft. A missing signing key, a 4xx from
 * Apple, or a network error logs and skips that row; the refresh retries on
 * the next scheduled tick. Risk-score plumbing is read-only (the gate logic
 * elsewhere reads `risk_metric` when present) so a stale or absent metric
 * never blocks verification.
 *
 * To enable end-to-end, set `APP_ATTEST_RECEIPT_SIGNING_KEY` (PEM-encoded
 * P-256 PKCS#8 private key from Apple Developer → Keys → "App Attest"
 * capability), `APP_ATTEST_RECEIPT_SIGNING_KEY_ID` (10-char Apple key ID),
 * and `APP_ATTEST_TEAM_ID` (defaults to `K667TL7H29`) in Infisical.
 */

const APP_ATTEST_RECEIPT_URL =
	"https://data.appattest.apple.com/v1/attestationData";
const REFRESH_INTERVAL_HOURS = 24;
const REFRESH_BATCH_SIZE = 100;
const APPLE_TEAM_ID_DEFAULT = "K667TL7H29";

type ReceiptRefreshEnv = {
	APP_ATTEST_RECEIPT_SIGNING_KEY?: string;
	APP_ATTEST_RECEIPT_SIGNING_KEY_ID?: string;
	APP_ATTEST_TEAM_ID?: string;
};

export async function refreshAppAttestReceipts({
	env,
	now = new Date(),
	log,
}: {
	env: ReceiptRefreshEnv;
	now?: Date;
	log?: ApiRequestLogger;
}): Promise<{ refreshed: number; skipped: number; failed: number }> {
	const stats = { refreshed: 0, skipped: 0, failed: 0 };

	if (
		!(
			env.APP_ATTEST_RECEIPT_SIGNING_KEY &&
			env.APP_ATTEST_RECEIPT_SIGNING_KEY_ID
		)
	) {
		// Pre-deploy state: signing material not yet provisioned. Skip silently
		// — the rest of the pipeline keeps working without riskMetric.
		return stats;
	}

	const cutoff = new Date(
		now.getTime() - REFRESH_INTERVAL_HOURS * 60 * 60 * 1000,
	);
	const dueRows = await db
		.select({
			keyId: mobile_attest_keys.keyId,
			receipt: mobile_attest_keys.receipt,
		})
		.from(mobile_attest_keys)
		.where(
			and(
				eq(mobile_attest_keys.provider, "ios_app_attest"),
				or(
					isNull(mobile_attest_keys.receiptRefreshedAt),
					lt(mobile_attest_keys.receiptRefreshedAt, cutoff),
				),
			),
		)
		.limit(REFRESH_BATCH_SIZE);

	if (dueRows.length === 0) {
		return stats;
	}

	const signingKey = await importApplePrivateKey(
		env.APP_ATTEST_RECEIPT_SIGNING_KEY,
	);
	const teamId = env.APP_ATTEST_TEAM_ID ?? APPLE_TEAM_ID_DEFAULT;
	const keyId = env.APP_ATTEST_RECEIPT_SIGNING_KEY_ID;

	for (const row of dueRows) {
		if (!row.receipt) {
			stats.skipped += 1;
			continue;
		}

		try {
			const jwt = await signAppleJwt({
				signingKey,
				teamId,
				keyId,
				now,
			});
			const result = await postReceiptToApple({
				jwt,
				receipt: row.receipt,
			});
			await db
				.update(mobile_attest_keys)
				.set({
					receipt: result.receipt,
					receiptRefreshedAt: now,
					riskMetric: result.riskMetric,
				})
				.where(eq(mobile_attest_keys.keyId, row.keyId));

			if (log) {
				logEvent(log, {
					details: {
						key_id: row.keyId,
						risk_metric: result.riskMetric,
					},
					event: "verify.attest.receipt_refreshed",
				});
			}
			stats.refreshed += 1;
		} catch (error) {
			stats.failed += 1;
			if (log) {
				logSafeError(log, {
					code: "verify_attest_receipt_refresh_failed",
					error,
					event: "verify.attest.receipt_refresh_failed",
					message: "Apple receipt refresh failed; will retry next tick.",
					status: 500,
				});
			}
			// Advance receiptRefreshedAt anyway so we don't hammer Apple with the
			// same bad receipt every minute. Do NOT clear `receipt` — preserving
			// the last-known-good receipt keeps the row useful for verification.
			await db
				.update(mobile_attest_keys)
				.set({ receiptRefreshedAt: now })
				.where(eq(mobile_attest_keys.keyId, row.keyId));
		}
	}

	return stats;
}

async function importApplePrivateKey(pem: string): Promise<CryptoKey> {
	const cleaned = pem
		.replace(/-----BEGIN PRIVATE KEY-----/u, "")
		.replace(/-----END PRIVATE KEY-----/u, "")
		.replace(/\s+/gu, "");
	const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey(
		"pkcs8",
		der as unknown as ArrayBuffer,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
}

async function signAppleJwt({
	signingKey,
	teamId,
	keyId,
	now,
}: {
	signingKey: CryptoKey;
	teamId: string;
	keyId: string;
	now: Date;
}): Promise<string> {
	const header = { alg: "ES256", kid: keyId, typ: "JWT" };
	const nowSec = Math.floor(now.getTime() / 1000);
	const claims = {
		iss: teamId,
		iat: nowSec,
		exp: nowSec + 20 * 60,
	};

	const headerSegment = base64UrlEncode(
		new TextEncoder().encode(JSON.stringify(header)),
	);
	const claimsSegment = base64UrlEncode(
		new TextEncoder().encode(JSON.stringify(claims)),
	);
	const signingInput = `${headerSegment}.${claimsSegment}`;

	const signature = await crypto.subtle.sign(
		{ hash: "SHA-256", name: "ECDSA" },
		signingKey,
		new TextEncoder().encode(signingInput),
	);

	return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function postReceiptToApple({
	jwt,
	receipt,
}: {
	jwt: string;
	receipt: string;
}): Promise<{ receipt: string; riskMetric: number }> {
	const response = await fetch(APP_ATTEST_RECEIPT_URL, {
		body: receipt,
		headers: {
			Authorization: `Bearer ${jwt}`,
			"Content-Type": "text/plain",
		},
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(`apple_receipt_endpoint_${response.status}`);
	}

	const refreshedReceipt = await response.text();
	const riskHeader = response.headers.get("x-apple-attestation-risk-metric");
	const riskMetric = riskHeader ? Number.parseInt(riskHeader, 10) : 0;

	return {
		receipt: refreshedReceipt,
		riskMetric: Number.isFinite(riskMetric) ? riskMetric : 0,
	};
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

/**
 * True roughly once per hour, sampled at the top of the hour. Mirrors the
 * cadence pattern in `shouldRunExpiredSessionNormalization` so the existing
 * Cron trigger can dispatch this without adding a new schedule.
 */
export function shouldRunReceiptRefresh(scheduledMs: number): boolean {
	const minute = new Date(scheduledMs).getUTCMinutes();
	return minute === 7;
}

// Suppress unused-import warning — `sql` is reserved for future use when we
// switch to a `RANDOM()`-ordered LIMIT for fairness across tenants.
void sql;
