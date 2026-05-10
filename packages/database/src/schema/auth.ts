import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const auth_users = pgTable("auth_users", {
	id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const auth_two_factors = pgTable(
	"auth_two_factors",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		userId: uuid("user_id")
			.notNull()
			.references(() => auth_users.id, { onDelete: "cascade" }),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		verified: boolean("verified").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("auth_two_factors_secret_idx").on(table.secret),
		index("auth_two_factors_userId_idx").on(table.userId),
	],
);

export const auth_accounts = pgTable(
	"auth_accounts",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: uuid("user_id")
			.notNull()
			.references(() => auth_users.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("auth_accounts_userId_idx").on(table.userId)],
);

export const auth_verifications = pgTable(
	"auth_verifications",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const organizationBusinessTypes = ["sole", "business"] as const;

export const auth_organizations = pgTable(
	"auth_organizations",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		logo: text("logo"),
		createdAt: timestamp("created_at").notNull(),
		metadata: text("metadata"),
		pending_deletion_at: timestamp("pending_deletion_at"),
		pending_deletion_requested_at: timestamp("pending_deletion_requested_at"),
		pending_deletion_requested_by: uuid(
			"pending_deletion_requested_by",
		).references(() => auth_users.id, { onDelete: "set null" }),
		/**
		 * When non-null, the organization owner has completed a Kayle ID identity
		 * check and the org is exempt from the unverified-org limits enforced by
		 * the sessions API. See `verification_records` for the dedup hash row that
		 * was written at verification time.
		 */
		verified_at: timestamp("verified_at"),
		businessType: text("business_type", {
			enum: organizationBusinessTypes,
		}),
		business_jurisdiction: text("business_jurisdiction"),
		business_name: text("business_name"),
		business_registration_number: text("business_registration_number"),
		verification_terms_accepted_at: timestamp("verification_terms_accepted_at"),
		verification_terms_accepted_by: uuid(
			"verification_terms_accepted_by",
		).references(() => auth_users.id, { onDelete: "set null" }),
	},
	(table) => [
		uniqueIndex("auth_organizations_slug_uidx").on(table.slug),
		index("auth_organizations_pending_deletion_at_idx").on(
			table.pending_deletion_at,
		),
		index("auth_organizations_verified_at_idx").on(table.verified_at),
	],
);

export const auth_organization_members = pgTable(
	"auth_organization_members",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => auth_users.id, { onDelete: "cascade" }),
		role: text("role").default("member").notNull(),
		createdAt: timestamp("created_at").notNull(),
	},
	(table) => [
		index("auth_organization_members_organizationId_idx").on(
			table.organizationId,
		),
		index("auth_organization_members_userId_idx").on(table.userId),
	],
);

export const auth_passkeys = pgTable(
	"auth_passkeys",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		name: text("name"),
		publicKey: text("public_key").notNull(),
		userId: uuid("user_id")
			.notNull()
			.references(() => auth_users.id, { onDelete: "cascade" }),
		credentialID: text("credential_id").notNull(),
		counter: integer("counter").notNull(),
		deviceType: text("device_type").notNull(),
		backedUp: boolean("backed_up").notNull(),
		transports: text("transports"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		aaguid: text("aaguid"),
	},
	(table) => [
		index("auth_passkeys_user_id_idx").on(table.userId),
		index("auth_passkeys_credential_id_idx").on(table.credentialID),
	],
);

export const auth_invitations = pgTable(
	"auth_invitations",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		role: text("role"),
		status: text("status").default("pending").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		inviterId: uuid("inviter_id")
			.notNull()
			.references(() => auth_users.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("auth_invitations_organizationId_idx").on(table.organizationId),
		index("auth_invitations_email_idx").on(table.email),
	],
);

export const organizationDomainVerificationMethods = ["dns_txt"] as const;
export type OrganizationDomainVerificationMethod =
	(typeof organizationDomainVerificationMethods)[number];

export const auth_organization_verified_domains = pgTable(
	"auth_organization_verified_domains",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		apexDomain: text("apex_domain").notNull(),
		verifiedAt: timestamp("verified_at").notNull(),
		verifiedVia: text("verified_via", {
			enum: organizationDomainVerificationMethods,
		}).notNull(),
		verifiedBy: uuid("verified_by").references(() => auth_users.id, {
			onDelete: "set null",
		}),
		recheckToken: text("recheck_token"),
		lastCheckedAt: timestamp("last_checked_at"),
		consecutiveFailedChecks: integer("consecutive_failed_checks")
			.default(0)
			.notNull(),
		downgradedAt: timestamp("downgraded_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("auth_org_verified_domains_org_apex_uidx").on(
			table.organizationId,
			table.apexDomain,
		),
		// Globally unique while active. Verifying an apex already held by
		// another org goes through an explicit takeover handshake (see
		// `verifyDnsChallenge` in domain-verification/service.ts) that
		// downgrades the previous owner's row in the same transaction.
		uniqueIndex("auth_org_verified_domains_active_apex_uidx")
			.on(table.apexDomain)
			.where(sql`${table.downgradedAt} is null`),
		index("auth_org_verified_domains_org_idx").on(table.organizationId),
		index("auth_org_verified_domains_downgraded_idx").on(table.downgradedAt),
	],
);

export const auth_organization_domain_challenges = pgTable(
	"auth_organization_domain_challenges",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		apexDomain: text("apex_domain").notNull(),
		method: text("method", {
			enum: organizationDomainVerificationMethods,
		}).notNull(),
		token: text("token").notNull(),
		emailAddress: text("email_address"),
		expiresAt: timestamp("expires_at").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: uuid("created_by").references(() => auth_users.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("auth_org_domain_challenges_org_apex_method_idx").on(
			table.organizationId,
			table.apexDomain,
			table.method,
		),
		index("auth_org_domain_challenges_expires_idx").on(table.expiresAt),
	],
);

export const auth_organization_redirect_uris = pgTable(
	"auth_organization_redirect_uris",
	{
		id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		verifiedDomainId: uuid("verified_domain_id")
			.notNull()
			.references(() => auth_organization_verified_domains.id, {
				onDelete: "cascade",
			}),
		pattern: text("pattern").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: uuid("created_by").references(() => auth_users.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		uniqueIndex("auth_org_redirect_uris_domain_pattern_uidx").on(
			table.verifiedDomainId,
			table.pattern,
		),
		index("auth_org_redirect_uris_org_idx").on(table.organizationId),
	],
);
