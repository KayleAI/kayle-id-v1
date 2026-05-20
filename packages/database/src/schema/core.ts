import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { auth_organizations } from "./auth";

export const verificationSessionStatuses = [
	"created",
	"in_progress",
	"succeeded",
	"failed",
	"expired",
	"cancelled",
] as const;

export const verificationSessionFailureCodes = [
	"document_authenticity_failed",
	"document_active_authentication_failed",
	"document_chip_authentication_failed",
	"document_anti_cloning_attestation_failed",
	"document_data_invalid",
	"liveness_failed",
	"selfie_face_mismatch",
] as const;

/**
 * Document type families recorded on the dedup hash row produced when an org
 * owner completes their identity check. Sourced from the MRZ document type
 * code in DG1; we collapse the various TD3/TD2/TD1 variants into a small
 * stable enum so reason codes / per-type rules can branch without parsing
 * raw MRZ values at query time.
 */
export const orgVerificationDocumentTypes = [
	"passport",
	"national_id",
	"residence_permit",
	"other",
] as const;

export const api_keys = pgTable(
	"api_keys",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		name: text("name").notNull(),
		keyHash: text("key_hash").notNull().unique(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		enabled: boolean("enabled").default(true).notNull(),
		requestCount: integer("request_count").default(0).notNull(),
		permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
		metadata: jsonb("metadata")
			.$type<Record<string, boolean | number | string>>()
			.default({})
			.notNull(),
	},
	(table) => [
		index("api_keys_org_id_idx").on(table.organizationId),
		index("api_keys_org_enabled_idx").on(table.organizationId, table.enabled),
	],
);

/**
 * Verification sessions are the sessions used by users to verify their identity.
 *
 * Users are anonymous in these sessions and we make no attempt to track them.
 *
 * @see https://docs.kayle.id/verification-sessions
 */
export const verification_sessions = pgTable(
	"verification_sessions",
	{
		/**
		 * The ID of the verification session.
		 *
		 * Always prefixed with `vs_...`
		 */
		id: text("id").primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		status: text({
			enum: verificationSessionStatuses,
		})
			.default("created")
			.notNull(),
		contractVersion: integer("contract_version").default(1).notNull(),
		shareFields: jsonb("share_fields").default({}).notNull(),
		redirectUrl: text("redirect_url"),
		webhookEndpointIds: jsonb("webhook_endpoint_ids").$type<string[]>(),
		/**
		 * HMAC-SHA256 of the one-shot cancel token issued at session creation.
		 *
		 * The plaintext token is returned exactly once in the create-session
		 * response and embedded in `verification_url` as a query parameter so the
		 * verify browser / native app can pass it back when cancelling. Required
		 * by `POST /v1/verify/session/:id/cancel`.
		 *
		 * Nullable so older rows that predate the cancel-token migration remain
		 * representable; on those rows the public cancel endpoint rejects with
		 * `CANCEL_TOKEN_INVALID`.
		 */
		cancelTokenHash: text("cancel_token_hash"),
		/**
		 * Timestamp of the first successful public cancel against this session.
		 * Once set, the cancel endpoint short-circuits subsequent calls (idempotent
		 * 204 if the session is already terminal, otherwise rejects with
		 * `CANCEL_TOKEN_USED`).
		 */
		cancelTokenConsumedAt: timestamp("cancel_token_consumed_at"),
		/**
		 * True when this session's share fields are limited to age-gate claims
		 * (`age_over_xx`) plus `kayle_document_id`. Such sessions are exempt
		 * from the unverified-org rate limit and warning UI because they reveal
		 * no identity-bearing attributes.
		 *
		 * Computed once at session creation from the normalized share fields so
		 * the rate-limit query can stay a cheap indexed count.
		 */
		isAgeOnly: boolean("is_age_only").default(false).notNull(),
		/**
		 * The expiration time of the verification session.
		 *
		 * @default 60 minutes after creation
		 */
		expiresAt: timestamp("expires_at")
			.default(sql`now() + interval '60 minutes'`)
			.notNull(),
		/**
		 * The time the verification session reached a terminal state
		 * (i.e., succeeded, failed, expired or cancelled).
		 */
		completedAt: timestamp("completed_at"),
		/**
		 * Terminal failure code, set when `status='failed'`. Null in any
		 * non-failed status.
		 */
		failureCode: text("failure_code", {
			enum: verificationSessionFailureCodes,
		}),
		/**
		 * Per-check retry counters. NFC and liveness each get up to 3 retries
		 * before the session terminalizes on that check. MRZ has no counter
		 * (unlimited client-side rescans).
		 */
		nfcTriesUsed: integer("nfc_tries_used").default(0).notNull(),
		livenessTriesUsed: integer("liveness_tries_used").default(0).notNull(),
		/**
		 * Risk score blended from per-check signals. Decimal 0..1.
		 */
		riskScore: real("risk_score").default(0).notNull(),
		/**
		 * Field keys the end user agreed to share on a successful verification.
		 * Distinct from `share_fields` which is the RP-requested catalogue.
		 */
		selectedShareFieldKeys: jsonb("selected_share_field_keys")
			.$type<string[]>()
			.default([])
			.notNull(),
		/**
		 * Current lifecycle phase. Stores phase metadata only, never MRZ/NFC/selfie payloads.
		 */
		currentPhase: text("current_phase"),
		phaseUpdatedAt: timestamp("phase_updated_at"),
		/**
		 * Mobile write token state for the single handoff per session lifetime.
		 */
		mobileWriteTokenSeed: text("mobile_write_token_seed"),
		mobileWriteTokenHash: text("mobile_write_token_hash"),
		mobileWriteTokenIssuedAt: timestamp("mobile_write_token_issued_at"),
		mobileWriteTokenExpiresAt: timestamp("mobile_write_token_expires_at"),
		mobileWriteTokenConsumedAt: timestamp("mobile_write_token_consumed_at"),
		mobileHelloDeviceIdHash: text("mobile_hello_device_id_hash"),
		mobileHelloAppVersion: text("mobile_hello_app_version"),
		/**
		 * Mobile attestation key bound at hello time. References
		 * `mobile_attest_keys.key_id`. Nullable for sessions that predate the
		 * App Attest gate.
		 */
		mobileAttestKeyId: text("mobile_attest_key_id"),
		/**
		 * Connection ID of the verify WebSocket that currently owns this session.
		 * Cleared on close; refused for re-claim while held by a different live
		 * connection. Stale claims are recovered after `claimedAt` ages out.
		 */
		claimedByConnectionId: text("claimed_by_connection_id"),
		claimedAt: timestamp("claimed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// List sessions for an org
		index("verif_sessions_org_idx").on(table.organizationId),
		// Expiry-based GC
		index("verif_sessions_expires_at_idx").on(table.expiresAt),
		index("verif_sessions_status_idx").on(table.status),
		// Quickly count non-age-only sessions for an org in a rolling window —
		// used by the unverified-org rate limit on session creation.
		index("verif_sessions_org_age_only_created_at_idx").on(
			table.organizationId,
			table.isAgeOnly,
			table.createdAt,
		),
		// Lookup sessions by attesting key (riskMetric refresh feedback path).
		index("verif_sessions_mobile_attest_key_idx").on(table.mobileAttestKeyId),
	],
);

/**
 * Dedup hash row written when an organization owner completes a Kayle ID
 * identity check. Stores only the document type family, issuing country, and
 * a peppered hash of the document number — never the raw document number.
 *
 * `dedupHash` carries a global uniqueness intent across all organizations: a
 * single document should be able to verify a single owner across the
 * platform. Per-org reuse policy is enforced higher up by inspecting rows
 * with the same hash; the table itself does not enforce uniqueness so older
 * pepper versions and migrations remain representable.
 */
export const org_verification_records = pgTable(
	"org_verification_records",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		dedupHash: text("dedup_hash").notNull(),
		pepperVersion: integer("pepper_version").default(1).notNull(),
		documentType: text("document_type", {
			enum: orgVerificationDocumentTypes,
		}).notNull(),
		issuingCountry: text("issuing_country").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("org_verification_records_dedup_hash_idx").on(table.dedupHash),
		index("org_verification_records_org_created_at_idx").on(
			table.organizationId,
			table.createdAt,
		),
	],
);

/**
 * Browser consent captured before issuing mobile handoff credentials.
 *
 * Stores claim keys and versioned acknowledgements only; no document, biometric,
 * MRZ, NFC, or claim values are persisted here.
 */
export const verification_consents = pgTable(
	"verification_consents",
	{
		/**
		 * The ID of the consent record.
		 *
		 * Always prefixed with `vc_...`
		 */
		id: text("id").primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		verificationSessionId: text("verification_session_id")
			.notNull()
			.references(() => verification_sessions.id, { onDelete: "cascade" }),
		consentedAt: timestamp("consented_at").defaultNow().notNull(),
		consentUiVersion: integer("consent_ui_version").notNull(),
		termsVersion: text("terms_version").notNull(),
		privacyNoticeVersion: text("privacy_notice_version").notNull(),
		shareContractHash: text("share_contract_hash").notNull(),
		requestedClaimKeys: jsonb("requested_claim_keys")
			.$type<string[]>()
			.default([])
			.notNull(),
		selectedClaimKeys: jsonb("selected_claim_keys")
			.$type<string[]>()
			.default([])
			.notNull(),
		requiredClaimKeys: jsonb("required_claim_keys")
			.$type<string[]>()
			.default([])
			.notNull(),
		documentProcessingConsent: boolean("document_processing_consent")
			.default(false)
			.notNull(),
		biometricConsent: boolean("biometric_consent").default(false).notNull(),
		shareClaimsConsent: boolean("share_claims_consent")
			.default(false)
			.notNull(),
		termsAcknowledged: boolean("terms_acknowledged").default(false).notNull(),
		privacyNoticeAcknowledged: boolean("privacy_notice_acknowledged")
			.default(false)
			.notNull(),
		rpName: text("rp_name").notNull(),
		controllerName: text("controller_name").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("verif_consents_session_created_idx").on(
			table.verificationSessionId,
			table.createdAt,
		),
		index("verif_consents_org_created_idx").on(
			table.organizationId,
			table.createdAt,
		),
	],
);

/**
 * Providers of mobile attestation. The schema stores a per-device row only for
 * iOS (App Attest mints a hardware-backed P-256 keypair we verify per-request);
 * Android Play Integrity yields stateless tokens that are verified per-request
 * against Google's keys, so a row exists only as a logical anchor.
 */
export const mobileAttestProviders = [
	"ios_app_attest",
	"android_play_integrity",
] as const;

/**
 * Hardware-attested mobile keys used as the device + app trust anchor for
 * verify attempts. Populated by `POST /v1/verify/attest/register` on iOS.
 *
 * For `ios_app_attest`:
 *   - `keyId` is the Apple-issued base64url SHA-256 of the credCert public
 *     key. Identifies the Secure-Enclave-resident private key.
 *   - `publicKeyCose` is the COSE_Key (CBOR) encoding of the EC2 P-256 public
 *     key extracted from the attestation's credCert; used to verify every
 *     subsequent assertion.
 *   - `counter` is the WebAuthn-style monotonic counter. Strictly increases
 *     across assertions; persisted atomically.
 *   - `receipt` is Apple's opaque CMS receipt, used for periodic riskMetric
 *     refresh against `https://data.appattest.apple.com`. The refreshed
 *     receipt and the `riskMetric` it carries feed the per-attempt risk score.
 *
 * For `android_play_integrity` (future): only `keyId` (a server-minted device
 * anchor) is set; `publicKeyCose`/`counter`/`receipt` stay null.
 */
export const mobile_attest_keys = pgTable(
	"mobile_attest_keys",
	{
		/**
		 * Base64url-encoded SHA-256 of the attested public key (iOS) or a
		 * server-minted opaque device anchor (Android). Globally unique.
		 */
		keyId: text("key_id").primaryKey(),
		provider: text({
			enum: mobileAttestProviders,
		}).notNull(),
		/**
		 * COSE_Key (CBOR) encoding of the attested EC2 P-256 public key,
		 * stored base64-encoded. iOS only; null for Android.
		 */
		publicKeyCose: text("public_key_cose"),
		/**
		 * Last assertion counter accepted by the server. Strictly monotonic
		 * across assertion verifications. iOS only; null for Android.
		 */
		counter: integer("counter").default(0).notNull(),
		/**
		 * Apple App Attest receipt, base64-encoded. iOS only; null for Android.
		 * Refreshed periodically out-of-band; superseded by each refresh.
		 */
		receipt: text("receipt"),
		/**
		 * Time of last receipt refresh against Apple's attestation data
		 * service. Null on freshly-registered keys; the refresh handler picks
		 * up null-or-stale rows.
		 */
		receiptRefreshedAt: timestamp("receipt_refreshed_at"),
		/**
		 * Risk metric reported by Apple (or 0 on Android). Higher values
		 * indicate the device has minted an unusual number of keys; feeds the
		 * per-attempt riskScore as a soft signal.
		 */
		riskMetric: integer("risk_metric"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
	},
	(table) => [
		// Refresh handler scans for stale or never-refreshed rows.
		index("mobile_attest_keys_receipt_refresh_idx").on(
			table.receiptRefreshedAt,
		),
		// Filter by provider (e.g. when the Android path lands).
		index("mobile_attest_keys_provider_idx").on(table.provider),
		// Retention sweeper scans by last use before deleting stale attestation keys.
		index("mobile_attest_keys_last_used_idx").on(table.lastUsedAt),
	],
);

/**
 * Logical events generated by Kayle ID.
 *
 * These are domain-agnostic records of “something happened”
 * (e.g., a verification attempt succeeded).
 *
 * They do NOT contain any plaintext PII.
 */
export const events = pgTable(
	"events",
	{
		/**
		 * The ID of the event.
		 *
		 * Always prefixed with `evt_...`
		 */
		id: text("id").primaryKey(),

		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),

		/**
		 * The type of the event.
		 *
		 * Examples:
		 * - verification.session.succeeded
		 * - verification.session.failed
		 * - verification.session.expired
		 */
		type: text("type").notNull(),

		/**
		 * The ID of the object that triggered this event.
		 *
		 * This is a generic reference and is not a foreign key.
		 * For example:
		 * - a verification session ID (`vs_...`)
		 * - a verification attempt ID (`va_...`)
		 */
		triggerId: text("trigger_id").notNull(),

		/**
		 * The type of the object that triggered this event.
		 *
		 * For example:
		 * - verification_session
		 * - verification_attempt
		 */
		triggerType: text("trigger_type").notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		// Events per org ordered by time
		index("events_org_created_idx").on(table.organizationId, table.createdAt),
		// Filter by type
		index("events_type_idx").on(table.type),
	],
);
