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
