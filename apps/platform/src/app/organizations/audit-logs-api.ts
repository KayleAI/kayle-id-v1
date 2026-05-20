import { type Pagination, requestApiResourcePage } from "@/utils/api-client";

const ORG_AUDIT_LOGS_BASE_PATH = "/api/auth/orgs";

export const ORGANIZATION_AUDIT_LOGS_QUERY_KEY = [
	"organization",
	"audit-logs",
] as const;

export interface AuditLogActor {
	id: string | null;
	type: "user" | "system" | "api_key";
	name: string | null;
	email: string | null;
	apiKeyId: string | null;
	apiKeyName: string | null;
}

export interface AuditLogEntry {
	id: string;
	event: string;
	actor: AuditLogActor;
	targetId: string | null;
	targetType: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
}

export interface AuditLogPage {
	data: AuditLogEntry[];
	pagination: Pagination;
}

export interface AuditLogsListInput {
	actorApiKeyId?: string;
	actorType?: "user" | "system" | "api_key";
	actorUserId?: string;
	createdFrom?: string;
	createdTo?: string;
	// One or more event names. Wire format is a comma-separated list; an empty
	// array is treated the same as omitting the filter.
	events?: readonly string[];
	limit?: number;
	q?: string;
	startingAfter?: string;
}

export async function listAuditLogs(
	input?: AuditLogsListInput,
): Promise<AuditLogPage> {
	const eventParam =
		input?.events && input.events.length > 0
			? input.events.join(",")
			: undefined;
	return await requestApiResourcePage<AuditLogEntry>({
		basePath: ORG_AUDIT_LOGS_BASE_PATH,
		method: "GET",
		path: "/audit-logs",
		query: {
			actor_api_key_id: input?.actorApiKeyId,
			actor_type: input?.actorType,
			actor_user_id: input?.actorUserId,
			created_from: input?.createdFrom,
			created_to: input?.createdTo,
			event: eventParam,
			limit: input?.limit,
			q: input?.q,
			starting_after: input?.startingAfter,
		},
		unexpectedMessage: "Failed to load audit logs.",
	});
}
