import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import { generateRandomString } from "better-auth/crypto";

/**
 * Canonical set of audit-log event names. New event names should be added
 * here so the read-side filter UI can present a complete list and so the
 * call sites stay grep-able.
 */
export const AUDIT_LOG_EVENTS = [
  // Verification sessions
  "session.created",
  "session.cancelled",
  "session.expired",
  "session.succeeded",
  // Per-attempt failure inside a session that still has retries left.
  "session.attempt.failed",
  // Session-level terminal failure: the retry budget was exhausted without a
  // successful attempt. `session.failed` is intentionally only emitted at this
  // point (not on every individual attempt failure) so the read-side surface
  // matches the user-visible session outcome.
  "session.failed",
  // Organization profile
  "organization.public_details.updated",
  "organization.logo.updated",
  "organization.business_details.updated",
  "organization.rp_terms.accepted",
  // Domain verification + redirect URIs
  "domain.challenge.started",
  "domain.verified",
  "domain.removed",
  "domain.downgraded",
  "redirect_uri.added",
  "redirect_uri.removed",
  // Members
  "member.invited",
  "member.invitation.cancelled",
  "member.joined",
  // `member.removed` is retained for historical rows written before the
  // suspension flow shipped. New rows use `member.suspended`/`member.left`
  // (a self-leave is also a suspension) and `member.reinstated`. Membership
  // rows are never hard-deleted through user-facing flows.
  "member.removed",
  "member.suspended",
  "member.left",
  "member.reinstated",
  "member.role.changed",
  // Distinct from `member.role.changed` so the UI can surface ownership
  // transfers separately. Emitted in addition to `member.role.changed` whenever
  // a member's role is promoted to include `owner`.
  "organization.ownership.assigned",
  // API keys
  "api_key.created",
  "api_key.updated",
  "api_key.deleted",
  // Webhooks
  "webhook_endpoint.created",
  "webhook_endpoint.updated",
  "webhook_endpoint.deleted",
  "webhook_endpoint.signing_secret.rotated",
] as const;

export type AuditLogEvent = (typeof AUDIT_LOG_EVENTS)[number];

interface BaseAuditLogEntry {
  event: AuditLogEvent;
  metadata?: Record<string, unknown>;
  organizationId: string;
  targetId?: string | null;
  targetType?: string | null;
}

interface UserAuditLogEntry extends BaseAuditLogEntry {
  actorType: "user";
  actorUserId: string;
}

/**
 * A programmatic call authenticated by an API key. The audit row attributes
 * the action to the key (and via the joined `api_keys.name`, to its label),
 * not to the catch-all `system` actor — those two were getting conflated and
 * made it impossible to filter "what did key X do" or distinguish a cron run
 * from a customer's automation.
 */
interface ApiKeyAuditLogEntry extends BaseAuditLogEntry {
  actorApiKeyId: string;
  actorType: "api_key";
  actorUserId?: null;
}

interface SystemAuditLogEntry extends BaseAuditLogEntry {
  actorType: "system";
  actorUserId?: string | null;
}

export type AuditLogEntry =
  | UserAuditLogEntry
  | ApiKeyAuditLogEntry
  | SystemAuditLogEntry;

/**
 * Drizzle's transaction type is large and derived; we accept anything with
 * an `insert` method that produces a chainable values clause so this helper
 * can run inside `db.transaction(async (tx) => ...)` *and* against the bare
 * `db` connection. This mirrors the pattern used by the verification session
 * repo's helpers.
 */
type AuditLogExecutor = Pick<typeof db, "insert">;

function generateAuditLogId(): string {
  return `aud_${generateRandomString(48)}`;
}

/**
 * Insert an audit-log row.
 *
 * Pass an explicit `tx` when the audit row should be written atomically with
 * the mutation it describes. Outside a transaction the row is best-effort:
 * the caller should wrap the call in a `try/catch` and never let an audit
 * write fail the user-facing operation.
 */
export async function recordAuditLog(
  entry: AuditLogEntry,
  executor: AuditLogExecutor = db
): Promise<void> {
  const actorUserId =
    entry.actorType === "user"
      ? entry.actorUserId
      : (entry.actorUserId ?? null);
  const actorApiKeyId =
    entry.actorType === "api_key" ? entry.actorApiKeyId : null;
  await executor.insert(audit_logs).values({
    id: generateAuditLogId(),
    organizationId: entry.organizationId,
    actorUserId,
    actorApiKeyId,
    actorType: entry.actorType,
    event: entry.event,
    targetId: entry.targetId ?? null,
    targetType: entry.targetType ?? null,
    metadata: entry.metadata ?? {},
  });
}

/**
 * Best-effort variant for callers that should never fail user requests on
 * an audit-write error. Logs nothing — the call site is responsible for
 * surfacing the failure to its own structured logger if desired.
 */
export async function recordAuditLogSafe(
  entry: AuditLogEntry,
  executor: AuditLogExecutor = db
): Promise<void> {
  try {
    await recordAuditLog(entry, executor);
  } catch {
    // Swallow — audit writes are non-essential for the request path.
  }
}
