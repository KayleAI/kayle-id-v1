import { constantTimeStringEqual } from "@kayle-id/config/constant-time";
import { env } from "@kayle-id/config/env";
import {
  createSafeRequestLogger,
  logEvent,
  logSafeError,
} from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import {
  auth_organization_members,
  auth_organizations,
  auth_users,
  auth_verifications,
} from "@kayle-id/database/schema/auth";
import { sendOrgDeletionCanceled } from "@kayle-id/emails/send-org-deletion-canceled";
import { sendOrgDeletionCode } from "@kayle-id/emails/send-org-deletion-code";
import { sendOrgDeletionScheduled } from "@kayle-id/emails/send-org-deletion-scheduled";
import { generateRandomString } from "better-auth/crypto";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  memberHasAdminOrOwnerRoleSql,
  memberHasOwnerRoleSql,
} from "./organization-role-sql";
import { hasOrgRole } from "./permissions";

const CONFIRMATION_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const GRACE_WINDOW_MS = 48 * 60 * 60 * 1000;
const CONFIRMATION_CODE_LENGTH = 8;

/**
 * Identifier prefix for org-deletion confirmation codes stored in
 * `auth_verifications`. Per-(org, requester) so the same user can request
 * deletion for multiple orgs concurrently without colliding.
 */
function verificationIdentifier(orgId: string, userId: string): string {
  return `org-delete-confirm:${orgId}:${userId}`;
}

export class OrgDeletionError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function getOrgRoleOrThrow(
  orgId: string,
  userId: string
): Promise<string> {
  const [member] = await db
    .select({ role: auth_organization_members.role })
    .from(auth_organization_members)
    .where(
      and(
        eq(auth_organization_members.organizationId, orgId),
        eq(auth_organization_members.userId, userId),
        // Suspended memberships behave as non-membership for permission checks.
        isNull(auth_organization_members.suspendedAt)
      )
    )
    .limit(1);

  if (!member) {
    throw new OrgDeletionError(
      "NOT_A_MEMBER",
      "You are not a member of this organization.",
      403
    );
  }
  return member.role;
}

function isOwner(role: string): boolean {
  return hasOrgRole(role, "owner");
}

function isAdminOrOwner(role: string): boolean {
  return hasOrgRole(role, "admin");
}

interface OrgRow {
  id: string;
  name: string;
  pendingDeletionAt: Date | null;
  pendingDeletionRequestedAt: Date | null;
  pendingDeletionRequestedBy: string | null;
  slug: string;
}

async function getOrgRowOrThrow(orgId: string): Promise<OrgRow> {
  const [row] = await db
    .select({
      id: auth_organizations.id,
      name: auth_organizations.name,
      slug: auth_organizations.slug,
      pendingDeletionAt: auth_organizations.pending_deletion_at,
      pendingDeletionRequestedAt:
        auth_organizations.pending_deletion_requested_at,
      pendingDeletionRequestedBy:
        auth_organizations.pending_deletion_requested_by,
    })
    .from(auth_organizations)
    .where(eq(auth_organizations.id, orgId))
    .limit(1);

  if (!row) {
    throw new OrgDeletionError(
      "ORGANIZATION_NOT_FOUND",
      "Organization not found.",
      404
    );
  }
  return row;
}

export interface OrgDeletionState {
  pendingDeletionAt: Date | null;
  pendingDeletionRequestedAt: Date | null;
  pendingDeletionRequestedBy: string | null;
}

export async function getOrgDeletionState(
  orgId: string
): Promise<OrgDeletionState | null> {
  const [row] = await db
    .select({
      pendingDeletionAt: auth_organizations.pending_deletion_at,
      pendingDeletionRequestedAt:
        auth_organizations.pending_deletion_requested_at,
      pendingDeletionRequestedBy:
        auth_organizations.pending_deletion_requested_by,
    })
    .from(auth_organizations)
    .where(eq(auth_organizations.id, orgId))
    .limit(1);
  return row ?? null;
}

export function isOrgFrozen(org: {
  pendingDeletionAt: Date | string | null | undefined;
}): boolean {
  return org.pendingDeletionAt !== null && org.pendingDeletionAt !== undefined;
}

export async function assertOrgNotFrozen(orgId: string): Promise<void> {
  const state = await getOrgDeletionState(orgId);
  if (state && state.pendingDeletionAt !== null) {
    throw new OrgDeletionError(
      "ORGANIZATION_FROZEN",
      "This organization is scheduled for deletion and cannot be modified.",
      410
    );
  }
}

async function listOwnersAndAdmins(orgId: string): Promise<
  {
    userId: string;
    email: string;
    name: string;
    role: string;
  }[]
> {
  return await db
    .select({
      userId: auth_organization_members.userId,
      email: auth_users.email,
      name: auth_users.name,
      role: auth_organization_members.role,
    })
    .from(auth_organization_members)
    .innerJoin(auth_users, eq(auth_users.id, auth_organization_members.userId))
    .where(
      and(
        eq(auth_organization_members.organizationId, orgId),
        // Notify only active owners/admins; suspended rows are bookkeeping.
        isNull(auth_organization_members.suspendedAt)
      )
    );
}

function shouldSendEmail(): boolean {
  return process.env.NODE_ENV === "production";
}

function getDeletionLogger() {
  return createSafeRequestLogger(
    new Request("https://kayle.invalid/internal/org-deletion", {
      method: "POST",
    })
  );
}

/**
 * Emit a structured "would-have-emailed" event in non-production environments.
 * No PII: we record only counts/booleans and an opaque event tag — never the
 * recipient address, requester name, or the confirmation code itself.
 */
function logDevEmail(
  event: string,
  details: Record<string, number | boolean | string>
): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  const logger = getDeletionLogger();
  logEvent(logger, {
    details,
    event,
    level: "warn",
  });
  logger.emit({ _forceKeep: true });
}

interface RequestOrgDeletionInput {
  now?: Date;
  organizationId: string;
  userId: string;
}

export async function requestOrgDeletion({
  organizationId,
  userId,
  now = new Date(),
}: RequestOrgDeletionInput): Promise<{ sentToEmail: string }> {
  const role = await getOrgRoleOrThrow(organizationId, userId);
  if (!isOwner(role)) {
    throw new OrgDeletionError(
      "FORBIDDEN",
      "Only an owner can request organization deletion.",
      403
    );
  }

  const org = await getOrgRowOrThrow(organizationId);
  if (org.pendingDeletionAt !== null) {
    throw new OrgDeletionError(
      "ALREADY_SCHEDULED",
      "This organization is already scheduled for deletion. Cancel it first to start over.",
      409
    );
  }

  const [requester] = await db
    .select({ email: auth_users.email, name: auth_users.name })
    .from(auth_users)
    .where(eq(auth_users.id, userId))
    .limit(1);

  if (!requester) {
    throw new OrgDeletionError("USER_NOT_FOUND", "Requester not found.", 404);
  }

  const code = generateRandomString(
    CONFIRMATION_CODE_LENGTH,
    "A-Z",
    "0-9"
  ).toUpperCase();
  const identifier = verificationIdentifier(organizationId, userId);
  const expiresAt = new Date(now.getTime() + CONFIRMATION_CODE_TTL_MS);

  await db.transaction(async (tx) => {
    await tx
      .delete(auth_verifications)
      .where(eq(auth_verifications.identifier, identifier));
    await tx.insert(auth_verifications).values({
      identifier,
      value: code,
      expiresAt,
    });
  });

  if (shouldSendEmail()) {
    await sendOrgDeletionCode({
      binding: env.SEND_EMAIL,
      code,
      expiresInMinutes: Math.floor(CONFIRMATION_CODE_TTL_MS / 60_000),
      from: env.EMAIL_FROM_ADDRESS,
      organizationName: org.name,
      to: requester.email,
    });
  } else {
    logDevEmail("org_deletion.code.dev_skipped", {
      code_length: code.length,
      organization_id: organizationId,
    });
  }

  return { sentToEmail: requester.email };
}

interface ConfirmOrgDeletionInput {
  code: string;
  now?: Date;
  organizationId: string;
  userId: string;
}

export async function confirmOrgDeletion({
  organizationId,
  userId,
  code,
  now = new Date(),
}: ConfirmOrgDeletionInput): Promise<{ pendingDeletionAt: Date }> {
  const role = await getOrgRoleOrThrow(organizationId, userId);
  if (!isOwner(role)) {
    throw new OrgDeletionError(
      "FORBIDDEN",
      "Only an owner can confirm organization deletion.",
      403
    );
  }

  const org = await getOrgRowOrThrow(organizationId);
  if (org.pendingDeletionAt !== null) {
    throw new OrgDeletionError(
      "ALREADY_SCHEDULED",
      "This organization is already scheduled for deletion.",
      409
    );
  }

  const identifier = verificationIdentifier(organizationId, userId);
  const submittedCode = code.trim().toUpperCase();

  const pendingDeletionAt = new Date(now.getTime() + GRACE_WINDOW_MS);

  await db.transaction(async (tx) => {
    const [verification] = await tx
      .select({
        id: auth_verifications.id,
        value: auth_verifications.value,
        expiresAt: auth_verifications.expiresAt,
      })
      .from(auth_verifications)
      .where(eq(auth_verifications.identifier, identifier))
      .limit(1);

    if (!verification) {
      throw new OrgDeletionError(
        "INVALID_CODE",
        "No pending confirmation code for this organization. Request a new code.",
        400
      );
    }
    if (verification.expiresAt.getTime() < now.getTime()) {
      throw new OrgDeletionError(
        "CODE_EXPIRED",
        "Confirmation code has expired. Request a new code.",
        400
      );
    }
    if (!constantTimeStringEqual(verification.value, submittedCode)) {
      throw new OrgDeletionError(
        "INVALID_CODE",
        "Confirmation code does not match.",
        400
      );
    }

    const [scheduled] = await tx
      .update(auth_organizations)
      .set({
        pending_deletion_at: pendingDeletionAt,
        pending_deletion_requested_at: now,
        pending_deletion_requested_by: userId,
      })
      .where(
        and(
          eq(auth_organizations.id, organizationId),
          isNull(auth_organizations.pending_deletion_at),
          exists(
            tx
              .select({ presence: sql`1` })
              .from(auth_organization_members)
              .where(
                and(
                  eq(
                    auth_organization_members.organizationId,
                    auth_organizations.id
                  ),
                  eq(auth_organization_members.userId, userId),
                  isNull(auth_organization_members.suspendedAt),
                  memberHasOwnerRoleSql()
                )
              )
          )
        )
      )
      .returning({ pendingDeletionAt: auth_organizations.pending_deletion_at });

    if (!scheduled?.pendingDeletionAt) {
      const [latestOrg] = await tx
        .select({ pendingDeletionAt: auth_organizations.pending_deletion_at })
        .from(auth_organizations)
        .where(eq(auth_organizations.id, organizationId))
        .limit(1);

      if (!latestOrg) {
        throw new OrgDeletionError(
          "ORGANIZATION_NOT_FOUND",
          "Organization not found.",
          404
        );
      }

      if (latestOrg.pendingDeletionAt !== null) {
        throw new OrgDeletionError(
          "ALREADY_SCHEDULED",
          "This organization is already scheduled for deletion.",
          409
        );
      }

      throw new OrgDeletionError(
        "FORBIDDEN",
        "Only an owner can confirm organization deletion.",
        403
      );
    }

    await tx
      .delete(auth_verifications)
      .where(eq(auth_verifications.id, verification.id));
  });

  // Notifications best-effort, post-commit. A failure here must not roll the
  // schedule back — callers can still cancel via the dashboard.
  try {
    const [requester] = await db
      .select({ name: auth_users.name })
      .from(auth_users)
      .where(eq(auth_users.id, userId))
      .limit(1);

    const recipients = await listOwnersAndAdmins(organizationId);
    const filtered = recipients.filter((r) => isAdminOrOwner(r.role));
    const cancelUrl = new URL(
      `/organizations/${org.slug}/settings`,
      env.PUBLIC_AUTH_URL
    ).toString();
    const deadlineLabel = pendingDeletionAt.toUTCString();
    const requesterName = requester?.name ?? "An owner";

    if (shouldSendEmail()) {
      await Promise.all(
        filtered.map((r) =>
          sendOrgDeletionScheduled({
            binding: env.SEND_EMAIL,
            cancelUrl,
            deadlineLabel,
            from: env.EMAIL_FROM_ADDRESS,
            organizationName: org.name,
            requesterName,
            to: r.email,
          })
        )
      );
    } else {
      logDevEmail("org_deletion.scheduled.dev_skipped", {
        organization_id: organizationId,
        recipient_count: filtered.length,
      });
    }
  } catch (err) {
    const logger = getDeletionLogger();
    logSafeError(logger, {
      code: "org_deletion_scheduled_notification_failed",
      details: { organization_id: organizationId },
      error: err,
      event: "org_deletion.scheduled.notification_failed",
      message: "Failed to send org-deletion scheduled notifications.",
      status: 500,
    });
    logger.emit({ _forceKeep: true });
  }

  return { pendingDeletionAt };
}

interface CancelOrgDeletionInput {
  actingUserId: string;
  organizationId: string;
}

export async function cancelOrgDeletion({
  organizationId,
  actingUserId,
}: CancelOrgDeletionInput): Promise<void> {
  const role = await getOrgRoleOrThrow(organizationId, actingUserId);
  if (!isAdminOrOwner(role)) {
    throw new OrgDeletionError(
      "FORBIDDEN",
      "Only owners or admins can cancel a scheduled deletion.",
      403
    );
  }

  const org = await getOrgRowOrThrow(organizationId);
  if (org.pendingDeletionAt === null) {
    throw new OrgDeletionError(
      "NOT_SCHEDULED",
      "This organization is not scheduled for deletion.",
      404
    );
  }

  const [canceled] = await db
    .update(auth_organizations)
    .set({
      pending_deletion_at: null,
      pending_deletion_requested_at: null,
      pending_deletion_requested_by: null,
    })
    .where(
      and(
        eq(auth_organizations.id, organizationId),
        isNotNull(auth_organizations.pending_deletion_at),
        exists(
          db
            .select({ presence: sql`1` })
            .from(auth_organization_members)
            .where(
              and(
                eq(
                  auth_organization_members.organizationId,
                  auth_organizations.id
                ),
                eq(auth_organization_members.userId, actingUserId),
                isNull(auth_organization_members.suspendedAt),
                memberHasAdminOrOwnerRoleSql()
              )
            )
        )
      )
    )
    .returning({ name: auth_organizations.name });

  if (!canceled) {
    const [latestOrg] = await db
      .select({ pendingDeletionAt: auth_organizations.pending_deletion_at })
      .from(auth_organizations)
      .where(eq(auth_organizations.id, organizationId))
      .limit(1);

    if (!latestOrg) {
      throw new OrgDeletionError(
        "ORGANIZATION_NOT_FOUND",
        "Organization not found.",
        404
      );
    }

    if (latestOrg.pendingDeletionAt === null) {
      throw new OrgDeletionError(
        "NOT_SCHEDULED",
        "This organization is not scheduled for deletion.",
        404
      );
    }

    throw new OrgDeletionError(
      "FORBIDDEN",
      "Only owners or admins can cancel a scheduled deletion.",
      403
    );
  }

  try {
    const [actor] = await db
      .select({ name: auth_users.name })
      .from(auth_users)
      .where(eq(auth_users.id, actingUserId))
      .limit(1);
    const cancellerName = actor?.name ?? "An admin";
    const recipients = (await listOwnersAndAdmins(organizationId)).filter((r) =>
      isAdminOrOwner(r.role)
    );

    if (shouldSendEmail()) {
      await Promise.all(
        recipients.map((r) =>
          sendOrgDeletionCanceled({
            binding: env.SEND_EMAIL,
            cancellerName,
            from: env.EMAIL_FROM_ADDRESS,
            organizationName: canceled.name,
            to: r.email,
          })
        )
      );
    } else {
      logDevEmail("org_deletion.canceled.dev_skipped", {
        organization_id: organizationId,
        recipient_count: recipients.length,
      });
    }
  } catch (err) {
    const logger = getDeletionLogger();
    logSafeError(logger, {
      code: "org_deletion_canceled_notification_failed",
      details: { organization_id: organizationId },
      error: err,
      event: "org_deletion.canceled.notification_failed",
      message: "Failed to send org-deletion canceled notifications.",
      status: 500,
    });
    logger.emit({ _forceKeep: true });
  }
}

/**
 * Hard-delete the given orgs. FK cascades take care of members, invitations,
 * api_keys, webhooks, verification_sessions, etc.
 *
 * Sessions live in Redis (Better Auth secondary storage) and are not indexed
 * by `activeOrganizationId`, so we don't enumerate them here. The
 * `customSession` callback in `server.ts` derives the active organization
 * from the user's current memberships at read time, so a session whose
 * stored `activeOrganizationId` references a now-deleted org transparently
 * falls back to the first remaining membership (or null).
 *
 * Used by both the deletion cron and the user-deletion `beforeDelete` hook.
 * Caller is responsible for whatever pre-checks are appropriate for the path.
 */
export async function hardDeleteOrganizations(
  orgIds: string[]
): Promise<{ deleted: string[] }> {
  if (orgIds.length === 0) {
    return { deleted: [] };
  }

  await db
    .delete(auth_organizations)
    .where(inArray(auth_organizations.id, orgIds));

  return { deleted: orgIds };
}

/**
 * Cron entry — pick up to `limit` orgs whose grace period has elapsed and
 * hard-delete them. Mirrors the shape of `processDueWebhookDeliveries`.
 */
export async function processDueOrganizationDeletions({
  now = new Date(),
  limit = 20,
}: {
  now?: Date;
  limit?: number;
} = {}): Promise<{ deleted: string[] }> {
  // Postgres treats `NULL <= now` as NULL (not true), so this naturally
  // filters out rows where the deletion isn't scheduled.
  const due = await db
    .select({ id: auth_organizations.id })
    .from(auth_organizations)
    .where(lte(auth_organizations.pending_deletion_at, now))
    .limit(limit);

  if (due.length === 0) {
    return { deleted: [] };
  }
  return await hardDeleteOrganizations(due.map((row) => row.id));
}
