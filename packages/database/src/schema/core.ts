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
	"completed",
	"expired",
	"cancelled",
] as const;

export const verificationAttemptStatuses = [
	"in_progress",
	"succeeded",
	"failed",
	"cancelled",
] as const;

export const verificationAttemptFailureCodes = [
	"session_expired",
	"session_cancelled",
	"passport_authenticity_failed",
	"passport_active_authentication_failed",
	"passport_chip_authentication_failed",
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
		 * The time the verification session reached a terminal state (i.e., completed, expired or cancelled).
		 */
		completedAt: timestamp("completed_at"),
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

export const verification_attempts = pgTable(
	"verification_attempts",
	{
		/**
		 * The ID of the verification attempt.
		 *
		 * Always prefixed with `va_...`
		 */
		id: text("id").primaryKey(),
		/**
		 * The reference to the verification session that this attempt belongs to.
		 */
		verificationSessionId: text("verification_session_id")
			.notNull()
			.references(() => verification_sessions.id, { onDelete: "cascade" }),
		/**
		 * The status of the verification attempt.
		 *
		 * If the referenced session expires, this attempt will be marked as `failed`
		 * and `failure_code` will be set to `session_expired`.
		 */
		status: text({
			enum: verificationAttemptStatuses,
		})
			.default("in_progress")
			.notNull(),
		/**
		 * The code of the failure reason.
		 *
		 * This is only set if the attempt is marked as `failed`.
		 */
		failureCode: text("failure_code", {
			enum: verificationAttemptFailureCodes,
		}),
		/**
		 * Random seed used to derive a deterministic mobile write token for the current handoff credential.
		 *
		 * The seed itself is not accepted for authentication.
		 */
		mobileWriteTokenSeed: text("mobile_write_token_seed"),
		/**
		 * Hash of the mobile write token issued for this attempt handoff.
		 *
		 * Plaintext tokens are never persisted.
		 */
		mobileWriteTokenHash: text("mobile_write_token_hash"),
		/**
		 * Time when the current mobile write token was issued.
		 */
		mobileWriteTokenIssuedAt: timestamp("mobile_write_token_issued_at"),
		/**
		 * Time when the current mobile write token expires.
		 */
		mobileWriteTokenExpiresAt: timestamp("mobile_write_token_expires_at"),
		/**
		 * Time when the mobile write token was consumed by a successful mobile hello.
		 *
		 * Reserved for Phase 3 auth enforcement.
		 */
		mobileWriteTokenConsumedAt: timestamp("mobile_write_token_consumed_at"),
		/**
		 * Hash of the device identifier that first successfully authenticated hello for this attempt.
		 */
		mobileHelloDeviceIdHash: text("mobile_hello_device_id_hash"),
		/**
		 * App version reported by the device that authenticated hello for this attempt.
		 */
		mobileHelloAppVersion: text("mobile_hello_app_version"),
		/**
		 * Current lifecycle phase for this attempt.
		 *
		 * Stores phase metadata only, never MRZ/NFC/selfie payloads.
		 */
		currentPhase: text("current_phase"),
		/**
		 * Time when `current_phase` was last updated.
		 */
		phaseUpdatedAt: timestamp("phase_updated_at"),
		/**
		 * Degree of risk associated with the verification attempt.
		 *
		 * Stored as a decimal number between 0 and 1.
		 *
		 * @default 0
		 */
		riskScore: real("risk_score").default(0).notNull(),
		/**
		 * The time the verification attempt reached a terminal state (i.e., succeeded, failed or cancelled).
		 */
		completedAt: timestamp("completed_at"),
		/**
		 * Connection ID of the verify WebSocket that currently owns this attempt.
		 * Cleared when the socket closes; refused for re-claim while held by a
		 * different live connection. Stale claims are recovered after
		 * `claimedAt` ages past 15 minutes (see attempt-connection.ts).
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
		// Attempts by session
		index("verif_attempts_session_id_idx").on(table.verificationSessionId),
		// Filter by status (e.g. in_progress, failed)
		index("verif_attempts_status_idx").on(table.status),
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
		 * - verification.attempt.succeeded
		 * - verification.attempt.failed
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
