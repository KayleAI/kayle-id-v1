import { sql } from "drizzle-orm";
import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { auth_organizations, auth_users } from "./auth";

/**
 * Audit logs are an org-scoped, append-only record of every state-changing
 * action a member or system process takes against an organization. They are
 * surfaced to org owners/admins so they can independently review what happened
 * — who did what, when, and against which target — for compliance, incident
 * response, and member-trust reasons.
 *
 * `events` (core.ts) is a separate table whose rows fan out to webhook
 * deliveries and is intentionally opinionated about what types live there.
 * Audit logs cover a much broader surface (anything an admin might want to
 * see) and intentionally include rows that we never want to send over a
 * webhook (member role changes, API key creation, etc.), so the two are kept
 * separate.
 */
export const audit_logs = pgTable(
	"audit_logs",
	{
		/**
		 * Always prefixed with `aud_...`
		 */
		id: text("id").primaryKey(),

		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),

		/**
		 * The user who performed the action. `null` when the action was
		 * performed by a non-user actor — for example a cron job that expires
		 * sessions, a background worker that downgrades a stale verified
		 * domain, or a verify-flow attempt that succeeds/fails without a
		 * dashboard user in the loop.
		 */
		actorUserId: uuid("actor_user_id").references(() => auth_users.id, {
			onDelete: "set null",
		}),

		/**
		 * The actor type. Either `user` (a signed-in member acted via the
		 * dashboard or an API call performed under a session) or `system`
		 * (cron / background work / public verify endpoints with no dashboard
		 * user in the loop).
		 */
		actorType: text("actor_type", { enum: ["user", "system"] }).notNull(),

		/**
		 * Event name in dot-notation (e.g. `organization.business_details.updated`,
		 * `member.role.changed`, `webhook_endpoint.created`). The set of names
		 * is documented in `packages/auth/src/audit-logs.ts`.
		 */
		event: text("event").notNull(),

		/**
		 * Optional reference to the object the event was performed against.
		 * Generic — not a foreign key — because the target table varies by
		 * event (webhook endpoint, API key, redirect URI, member, ...).
		 */
		targetId: text("target_id"),
		targetType: text("target_type"),

		/**
		 * Free-form context that helps an admin make sense of the row.
		 * Never contains plaintext PII — only metadata such as the names of
		 * fields that changed, the old/new role on a role-change event, the
		 * domain on a domain-verification event, and so on.
		 */
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.default(sql`'{}'::jsonb`)
			.notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		// List the most recent rows for an org.
		index("audit_logs_org_created_idx").on(
			table.organizationId,
			table.createdAt,
		),
		// Filter by event name within an org.
		index("audit_logs_org_event_idx").on(table.organizationId, table.event),
		// Filter by actor (e.g. "everything @alice did").
		index("audit_logs_actor_user_idx").on(table.actorUserId),
	],
);

export const auditLogActorTypes = ["user", "system"] as const;
export type AuditLogActorType = (typeof auditLogActorTypes)[number];
