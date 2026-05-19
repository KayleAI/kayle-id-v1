import {
	ORGANIZATION_REPORT_REASONS,
	ORGANIZATION_REPORT_STATUSES,
} from "@kayle-id/config/organization-reports";
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
import { verification_sessions } from "./core";

export const organization_reports = pgTable(
	"organization_reports",
	{
		id: text("id").primaryKey(),
		reportedOrganizationId: uuid("reported_organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		verificationSessionId: text("verification_session_id").references(
			() => verification_sessions.id,
			{ onDelete: "set null" },
		),
		reason: text("reason", {
			enum: ORGANIZATION_REPORT_REASONS,
		}).notNull(),
		details: text("details"),
		status: text("status", {
			enum: ORGANIZATION_REPORT_STATUSES,
		})
			.default("open")
			.notNull(),
		reporterContext: jsonb("reporter_context")
			.$type<Record<string, unknown>>()
			.default(sql`'{}'::jsonb`)
			.notNull(),
		adminNote: text("admin_note"),
		resolvedAt: timestamp("resolved_at"),
		resolvedByUserId: uuid("resolved_by_user_id").references(
			() => auth_users.id,
			{ onDelete: "set null" },
		),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("organization_reports_status_created_idx").on(
			table.status,
			table.createdAt,
		),
		index("organization_reports_reason_idx").on(table.reason),
		index("organization_reports_reported_org_idx").on(
			table.reportedOrganizationId,
			table.createdAt,
		),
		index("organization_reports_session_idx").on(table.verificationSessionId),
	],
);
