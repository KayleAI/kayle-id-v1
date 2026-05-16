import { passkey } from "@better-auth/passkey";
import { TRUSTED_CLIENT_IP_HEADERS } from "@kayle-id/config/client-ip";
import { env } from "@kayle-id/config/env";
import { createSafeRequestLogger, logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { redis } from "@kayle-id/database/redis";
import { auth as authSchema } from "@kayle-id/database/schema";
import {
  auth_organization_members,
  auth_organizations,
} from "@kayle-id/database/schema/auth";
import { sendChangeEmailVerification } from "@kayle-id/emails/send-change-email-verification";
import { sendDeleteAccountVerification } from "@kayle-id/emails/send-delete-account-verification";
import { sendMagicLinkEmail } from "@kayle-id/emails/send-magic-link-email";
import { sendVerifyEmail } from "@kayle-id/emails/send-verify-email";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import {
  customSession,
  openAPI,
  organization,
  twoFactor,
} from "better-auth/plugins";
import { and, eq, isNull } from "drizzle-orm";
import { recordAuditLogSafe } from "./audit-logs";
import { isSafeAuthCallbackPath } from "./callback-url";
import { magic } from "./magic";
import { hardDeleteOrganizations, isOrgFrozen } from "./organization-deletion";
import {
  normalizeStoredOrganizationLogoUrl,
  OrganizationLogoUrlError,
} from "./organization-logo";
import {
  normalizeOrganizationMetadata,
  type OrganizationMetadata,
  OrganizationMetadataError,
} from "./organization-metadata";
import {
  normalizeOrganizationName,
  OrganizationNameError,
} from "./organization-name";
import {
  assertOrganizationSlug,
  OrganizationSlugError,
} from "./organization-slug";
import { findSoleOwnedOrganizations } from "./owned-organizations";
import {
  hasOrgRole,
  normalizeOrgRoleSet,
  OrganizationRoleError,
} from "./permissions";
import { normalizeProfileImage, ProfileImageError } from "./profile-image";
import type { Organization } from "./types";

const TWO_FACTOR_COOKIE_NAME = "two_factor";
const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes
const TWO_FACTOR_VERIFICATION_PREFIX = "2fa-";

/**
 * Bridge between `beforeUpdateOrganization` and `afterUpdateOrganization`.
 *
 * Better-auth's update hooks fire on either side of the row write, but the
 * after-hook only sees the resulting row — not the keys the caller actually
 * submitted. Without those keys we can't write a meaningful `updated_fields`
 * onto the audit-log entry, and we can't dedupe trivial logo-only updates
 * against the standalone logo-upload audit row.
 *
 * The map is keyed by `${userId}:${organizationId}` and entries expire after
 * a short TTL so a hook that throws between before and after doesn't leak.
 */
interface PendingOrgUpdate {
  expiresAt: number;
  submittedKeys: string[];
}
const PENDING_ORG_UPDATE_TTL_MS = 60_000;
const pendingOrgUpdates = new Map<string, PendingOrgUpdate>();

function pendingOrgUpdateKey(userId: string, organizationId: string): string {
  return `${userId}:${organizationId}`;
}

function recordPendingOrgUpdateKeys(
  userId: string,
  organizationId: string,
  submittedKeys: string[]
): void {
  const now = Date.now();
  // Drop expired entries opportunistically so the map can't grow unbounded.
  for (const [k, v] of pendingOrgUpdates) {
    if (v.expiresAt < now) {
      pendingOrgUpdates.delete(k);
    }
  }
  pendingOrgUpdates.set(pendingOrgUpdateKey(userId, organizationId), {
    expiresAt: now + PENDING_ORG_UPDATE_TTL_MS,
    submittedKeys,
  });
}

function takePendingOrgUpdateKeys(
  userId: string,
  organizationId: string
): string[] | null {
  const key = pendingOrgUpdateKey(userId, organizationId);
  const entry = pendingOrgUpdates.get(key);
  pendingOrgUpdates.delete(key);
  if (!entry || entry.expiresAt < Date.now()) {
    return null;
  }
  return entry.submittedKeys;
}

// Paths handled outside better-auth's built-in sign-in endpoints (magic-link
// verification + Google OAuth callback). The twoFactor plugin's after-hook
// only matches `/sign-in/email|username|phone-number`, so we re-implement the
// challenge handoff here to keep 2FA enforced on every sign-in path.
const TWO_FACTOR_ENFORCED_PATHS = new Set([
  "/magic/verify-otp",
  "/magic/verify-link",
  "/callback/google",
]);
const CALLBACK_URL_BODY_PATHS = new Set([
  "/change-email",
  "/delete-user",
  "/send-verification-email",
]);

const verifyEmailExpiryInSeconds = 60 * 60;
const verifyEmailExpiryInMinutes = verifyEmailExpiryInSeconds / 60;
const deleteAccountExpiryInSeconds = 60 * 60 * 24;
const deleteAccountExpiryInMinutes = deleteAccountExpiryInSeconds / 60;

/**
 * Best-effort decode of a better-auth email-verification JWT to detect whether
 * it carries a pending email change. We don't need to verify the signature —
 * better-auth verifies it on the verify endpoint; we only branch the email
 * copy on whether `updateTo` is present.
 */
function readEmailVerificationToken(
  token: string
): { updateTo?: string } | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const padded = parts[1].padEnd(
      parts[1].length + ((4 - (parts[1].length % 4)) % 4),
      "="
    );
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { updateTo?: string };
  } catch {
    return null;
  }
}

const user = {
  modelName: "auth_users",
  changeEmail: {
    enabled: true,
    // Without `sendChangeEmailConfirmation`, verified callers fall through to
    // the global `emailVerification.sendVerificationEmail` handler with a
    // single-step `change-email-verification` token — so one click on the
    // emailed link is enough to apply the change. Unverified callers update
    // immediately (their old address wasn't trusted anyway).
    updateEmailWithoutVerification: true,
  },
  deleteUser: {
    enabled: true,
    deleteTokenExpiresIn: deleteAccountExpiryInSeconds,
    sendDeleteAccountVerification: async ({ user: deletingUser, url }) => {
      if (process.env.NODE_ENV !== "production") {
        return;
      }

      await sendDeleteAccountVerification({
        binding: env.SEND_EMAIL,
        expiresInMinutes: deleteAccountExpiryInMinutes,
        from: env.EMAIL_FROM_ADDRESS,
        to: deletingUser.email,
        url,
      });
    },
    // Cascade-delete every organisation where the user is the sole owner.
    // Routed through `hardDeleteOrganizations` so the delete runs in a single
    // transaction with active-org reassignment for any sessions whose active
    // org is among them. FK cascades handle members/invitations/api_keys/
    // webhooks/verification_sessions. Orgs with co-owners are left intact.
    beforeDelete: async (deletingUser) => {
      const orgs = await findSoleOwnedOrganizations(deletingUser.id);
      if (orgs.length === 0) {
        return;
      }
      await hardDeleteOrganizations(orgs.map((org) => org.id));
    },
  },
} satisfies BetterAuthOptions["user"];

const magicLinkExpiryInSeconds = 15 * 60;
const magicLinkExpiryInMinutes = magicLinkExpiryInSeconds / 60;
const magicOtpSignInPath = "/v1/auth/magic/sign-in";
const publicAuthBaseURL = new URL("/api/auth", env.PUBLIC_AUTH_URL).toString();
const publicGoogleCallbackURL = new URL(
  "/api/auth/callback/google",
  publicAuthBaseURL
).toString();

// WebAuthn requires the relying-party ID to be a registrable domain that
// matches the origin where the credential is created/used. Our public site
// runs on `kayle.id` in production, `staging.kayle.id` in staging, and
// `localhost:3000` in development, while the auth server itself may sit on a
// different host (e.g. 127.0.0.1:8787). Derive these from PUBLIC_AUTH_URL so
// staging passkeys are tied to `staging.kayle.id` (not `kayle.id`) and don't
// cross the environment boundary.
const isProduction = process.env.NODE_ENV === "production";
const publicAuthOriginUrl = new URL(env.PUBLIC_AUTH_URL);
const passkeyRpID = isProduction ? publicAuthOriginUrl.hostname : "localhost";
const passkeyOrigin = isProduction
  ? publicAuthOriginUrl.origin
  : ["https://localhost:3000", "https://localhost:8787"];
const trustedOrigins = isProduction
  ? [publicAuthOriginUrl.origin]
  : ["https://localhost:3000", "https://localhost:8787"];

interface MagicOtpPayload {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification";
}

interface OrganizationPolicyInput {
  logo?: unknown;
  metadata?: unknown;
  name?: unknown;
}

interface UserProfileInput {
  image?: unknown;
}

function normalizeOrganizationPolicyInput<T extends OrganizationPolicyInput>(
  organization: T
):
  | { data: T & { logo?: null | string; metadata?: OrganizationMetadata } }
  | undefined {
  try {
    let hasChanges = false;
    const data: {
      logo?: null | string;
      metadata?: OrganizationMetadata;
      name?: string;
    } = {};
    if (organization.name !== undefined) {
      data.name = normalizeOrganizationName(organization.name);
      hasChanges = true;
    }

    const logo = normalizeStoredOrganizationLogoUrl(organization.logo);
    if (logo !== undefined) {
      data.logo = logo;
      hasChanges = true;
    }

    const metadata = normalizeOrganizationMetadata(organization.metadata);
    if (metadata !== undefined) {
      data.metadata = metadata;
      hasChanges = true;
    }

    if (!hasChanges) {
      return;
    }

    return {
      data: {
        ...organization,
        ...data,
      },
    };
  } catch (error) {
    if (error instanceof OrganizationNameError) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_ORGANIZATION_NAME",
        message: error.message,
      });
    }
    if (error instanceof OrganizationLogoUrlError) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_ORGANIZATION_LOGO",
        message: error.message,
      });
    }
    if (error instanceof OrganizationMetadataError) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_ORGANIZATION_METADATA",
        message: error.message,
      });
    }
    throw error;
  }
}

// biome-ignore lint/suspicious/useAwait: better-auth's databaseHooks signature requires async.
async function normalizeUserProfileInput<T extends UserProfileInput>(
  userData: T,
  context: unknown
): Promise<{ data: T & { image?: null | string } } | undefined> {
  if (
    !(context && typeof context === "object") ||
    Reflect.get(context, "path") !== "/update-user"
  ) {
    return;
  }

  try {
    const image = normalizeProfileImage(userData.image);
    if (image === undefined) {
      return;
    }
    return {
      data: {
        ...userData,
        image,
      },
    };
  } catch (error) {
    if (error instanceof ProfileImageError) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_PROFILE_IMAGE",
        message: error.message,
      });
    }
    throw error;
  }
}

function assertOrganizationSlugInput(slug: unknown): void {
  try {
    assertOrganizationSlug(slug);
  } catch (error) {
    if (error instanceof OrganizationSlugError) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_ORGANIZATION_SLUG",
        message: error.message,
      });
    }
    throw error;
  }
}

function normalizeOrganizationRoleInput(role: unknown): string {
  try {
    return normalizeOrgRoleSet(role);
  } catch (error) {
    if (error instanceof OrganizationRoleError) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_ORGANIZATION_ROLE",
        message: error.message,
      });
    }
    throw error;
  }
}

export function getActiveOrganizationId(session: unknown): string | null {
  if (!(session && typeof session === "object")) {
    return null;
  }

  const candidate = Reflect.get(session, "activeOrganizationId");
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

// Returns true when the given organization id matches the platform-admin
// org configured via the KAYLE_ORGANIZATION_ID env secret. When the env is
// unset (dev/test without an admin org), no org is platform admin.
//
// Reads from process.env at call-time rather than the validated env snapshot
// so tests can flip the value between cases. In production the secret is
// fixed for the lifetime of the worker, so call-time reads are equivalent.
export function isPlatformAdminOrganization(
  organizationId: string | null | undefined
): boolean {
  const adminId =
    typeof process === "undefined"
      ? env.KAYLE_ORGANIZATION_ID
      : process.env?.KAYLE_ORGANIZATION_ID;
  if (!(adminId && organizationId)) {
    return false;
  }
  return organizationId === adminId;
}

function logDevelopmentMagicOtp(
  payload: MagicOtpPayload,
  request?: Request
): void {
  const logger = createSafeRequestLogger(
    request ??
      new Request(`https://kayle.invalid${magicOtpSignInPath}`, {
        method: "POST",
      })
  );
  const event = "auth.magic_otp.generated";

  logEvent(logger, {
    details: {
      email: payload.email,
      otp: payload.otp,
      type: payload.type,
    },
    event,
  });
  logger.emit({ _forceKeep: true });
}

const plugins = [
  ...(process.env.NODE_ENV === "production" ? [] : [openAPI()]),
  organization({
    // We replace better-auth's immediate `/organization/delete` with our own
    // request/confirm/cancel state machine that runs on a 48h grace period.
    disableOrganizationDeletion: true,
    schema: {
      invitation: {
        modelName: "auth_invitations",
      },
      organization: {
        modelName: "auth_organizations",
        additionalFields: {
          pendingDeletionAt: {
            type: "date",
            required: false,
            input: false,
            fieldName: "pending_deletion_at",
          },
          pendingDeletionRequestedAt: {
            type: "date",
            required: false,
            input: false,
            fieldName: "pending_deletion_requested_at",
          },
          pendingDeletionRequestedBy: {
            type: "string",
            required: false,
            input: false,
            fieldName: "pending_deletion_requested_by",
          },
          verifiedAt: {
            type: "date",
            required: false,
            input: false,
            fieldName: "verified_at",
          },
          businessType: {
            type: "string",
            required: false,
            input: false,
            fieldName: "business_type",
          },
          businessJurisdiction: {
            type: "string",
            required: false,
            input: false,
            fieldName: "business_jurisdiction",
          },
          businessName: {
            type: "string",
            required: false,
            input: false,
            fieldName: "business_name",
          },
          businessRegistrationNumber: {
            type: "string",
            required: false,
            input: false,
            fieldName: "business_registration_number",
          },
          verificationTermsAcceptedAt: {
            type: "date",
            required: false,
            input: false,
            fieldName: "verification_terms_accepted_at",
          },
          verificationTermsAcceptedBy: {
            type: "string",
            required: false,
            input: false,
            fieldName: "verification_terms_accepted_by",
          },
        },
      },
      member: {
        modelName: "auth_organization_members",
      },
      organizationRole: {
        modelName: "auth_organization_roles",
      },
    },
    organizationHooks: {
      // biome-ignore lint/suspicious/useAwait: required
      beforeCreateOrganization: async ({ organization: org }) => {
        assertOrganizationSlugInput(org.slug);
        return normalizeOrganizationPolicyInput(org);
      },
      // Block org-scoped writes once a deletion is scheduled. Without these
      // hooks an admin/owner could add members, change roles, send invites,
      // or rename the org during the 48h freeze window.
      // biome-ignore lint/suspicious/useAwait: required
      beforeUpdateOrganization: async ({ organization: org, user, member }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }

        if (org.slug !== undefined) {
          assertOrganizationSlugInput(org.slug);
        }

        const normalized = normalizeOrganizationPolicyInput(org);
        // Capture the set of fields the caller actually submitted so the
        // matching `afterUpdateOrganization` hook can include them in the
        // audit-log metadata. Better-auth's after-hook only sees the resulting
        // row, not the input, so we bridge them via a small per-user map.
        const submittedKeys = Object.keys(org).filter(
          (key) => (org as Record<string, unknown>)[key] !== undefined
        );
        recordPendingOrgUpdateKeys(
          user.id,
          member.organizationId,
          submittedKeys
        );
        return normalized;
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeAddMember: async ({ member, organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
        const role = normalizeOrganizationRoleInput(member.role);
        return { data: { role } };
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeRemoveMember: async ({ organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeUpdateMemberRole: async ({ newRole, organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
        const role = normalizeOrganizationRoleInput(newRole);
        return { data: { role } };
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeCreateInvitation: async ({ invitation, organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
        const role = normalizeOrganizationRoleInput(invitation.role);
        return { data: { role } };
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeAcceptInvitation: async ({ invitation, organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
        normalizeOrganizationRoleInput(invitation.role);
      },
      // After-hooks emit audit-log rows so org admins can review who joined
      // or left, and how roles changed. We never let an audit write fail the
      // request itself — `recordAuditLogSafe` swallows insert errors.
      afterUpdateOrganization: async ({ organization: org, user }) => {
        if (!org) {
          return;
        }
        const submittedKeys = takePendingOrgUpdateKeys(user.id, org.id) ?? [];
        // A logo-only update is already captured by the dedicated logo-upload
        // route's `organization.logo.updated` row; emitting a second
        // `public_details.updated` row for the same user action would be noise.
        const isLogoOnlyUpdate =
          submittedKeys.length === 1 && submittedKeys[0] === "logo";
        if (isLogoOnlyUpdate) {
          return;
        }
        await recordAuditLogSafe({
          actorType: "user",
          actorUserId: user.id,
          organizationId: org.id,
          event: "organization.public_details.updated",
          targetId: org.id,
          targetType: "organization",
          metadata: {
            updated_fields: submittedKeys,
          },
        });
      },
      afterAddMember: async ({ member, organization: org, user }) => {
        await recordAuditLogSafe({
          actorType: "user",
          actorUserId: user.id,
          organizationId: org.id,
          event: "member.joined",
          targetId: member.id,
          targetType: "member",
          metadata: { user_id: member.userId, role: member.role },
        });
      },
      afterRemoveMember: async ({ member, organization: org, user }) => {
        await recordAuditLogSafe({
          actorType: "user",
          actorUserId: user.id,
          organizationId: org.id,
          event: "member.removed",
          targetId: member.id,
          targetType: "member",
          metadata: { user_id: member.userId, role: member.role },
        });
      },
      afterUpdateMemberRole: async ({
        member,
        previousRole,
        organization: org,
        user,
      }) => {
        await recordAuditLogSafe({
          actorType: "user",
          actorUserId: user.id,
          organizationId: org.id,
          event: "member.role.changed",
          targetId: member.id,
          targetType: "member",
          metadata: {
            user_id: member.userId,
            previous_role: previousRole,
            new_role: member.role,
          },
        });
        // Surface ownership transfer as a distinct event so the audit-log UI
        // can render it on its own row (and admins can filter on it). We still
        // emit `member.role.changed` above because that's the more general
        // record of what changed.
        const previousIsOwner = hasOrgRole(previousRole, "owner");
        const nextIsOwner = hasOrgRole(member.role, "owner");
        if (!previousIsOwner && nextIsOwner) {
          await recordAuditLogSafe({
            actorType: "user",
            actorUserId: user.id,
            organizationId: org.id,
            event: "organization.ownership.assigned",
            targetId: member.id,
            targetType: "member",
            metadata: {
              user_id: member.userId,
              previous_role: previousRole,
              new_role: member.role,
            },
          });
        }
      },
      afterCreateInvitation: async ({
        invitation,
        organization: org,
        inviter,
      }) => {
        await recordAuditLogSafe({
          actorType: "user",
          actorUserId: inviter.id,
          organizationId: org.id,
          event: "member.invited",
          targetId: invitation.id,
          targetType: "invitation",
          metadata: { email: invitation.email, role: invitation.role },
        });
      },
      afterCancelInvitation: async ({
        invitation,
        organization: org,
        cancelledBy,
      }) => {
        await recordAuditLogSafe({
          actorType: "user",
          actorUserId: cancelledBy.id,
          organizationId: org.id,
          event: "member.invitation.cancelled",
          targetId: invitation.id,
          targetType: "invitation",
          metadata: { email: invitation.email, role: invitation.role },
        });
      },
    },
  }),
  twoFactor({
    issuer: "Kayle ID",
    // The platform is passwordless (magic link + Google), so credential-based
    // re-authentication isn't available. Better-auth still requires a password
    // for users who *do* have a credential account, which is currently only
    // test fixtures (`emailAndPassword.enabled` is `NODE_ENV === "test"`).
    allowPasswordless: true,
    schema: {
      twoFactor: {
        modelName: "auth_two_factors",
      },
    },
  }),
  magic({
    expiresIn: magicLinkExpiryInSeconds,
    sendMagicOtpAuth: async (payload, request) => {
      if (process.env.NODE_ENV !== "production") {
        logDevelopmentMagicOtp(payload, request);
        return;
      }

      await sendMagicLinkEmail({
        binding: env.SEND_EMAIL,
        expiresInMinutes: magicLinkExpiryInMinutes,
        from: env.EMAIL_FROM_ADDRESS,
        otp: payload.otp,
        to: payload.email,
        type: payload.type,
        url: payload.url,
      });
    },
  }),
  passkey({
    rpID: passkeyRpID,
    rpName: "Kayle ID",
    origin: passkeyOrigin,
    schema: {
      passkey: {
        modelName: "auth_passkeys",
      },
    },
  }),
] satisfies BetterAuthOptions["plugins"];

// Mirrors the twoFactor plugin's after-hook (which only matches better-auth's
// built-in `/sign-in/email|username|phone-number`) for our magic-link and
// Google sign-in paths. When the just-completed sign-in belongs to a 2FA-enabled
// user, we drop the session that magic/oauth issued, mint a short-lived
// `two_factor` verification cookie, and return a `twoFactorRedirect` payload so
// the client can route to the TOTP challenge UI.
const enforceTwoFactorOnNonStandardSignIns = createAuthMiddleware(
  async (ctx) => {
    if (!TWO_FACTOR_ENFORCED_PATHS.has(ctx.path)) {
      return;
    }

    const data = ctx.context.newSession;
    if (!data?.user.twoFactorEnabled) {
      return;
    }

    deleteSessionCookie(ctx, true);
    await ctx.context.internalAdapter.deleteSession(data.session.token);

    const twoFactorCookie = ctx.context.createAuthCookie(
      TWO_FACTOR_COOKIE_NAME,
      {
        maxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS,
      }
    );
    const identifier = `${TWO_FACTOR_VERIFICATION_PREFIX}${generateRandomString(20)}`;
    await ctx.context.internalAdapter.createVerificationValue({
      identifier,
      value: data.user.id,
      expiresAt: new Date(
        Date.now() + TWO_FACTOR_COOKIE_MAX_AGE_SECONDS * 1000
      ),
    });
    await ctx.setSignedCookie(
      twoFactorCookie.name,
      identifier,
      ctx.context.secret,
      twoFactorCookie.attributes
    );

    return ctx.json({
      twoFactorRedirect: true,
      twoFactorMethods: ["totp"],
    });
  }
);

// biome-ignore lint/suspicious/useAwait: createAuthMiddleware requires an async callback signature.
const enforceSafeCallbackURLBodies = createAuthMiddleware(async (ctx) => {
  if (!CALLBACK_URL_BODY_PATHS.has(ctx.path)) {
    return;
  }

  if (!(ctx.body && typeof ctx.body === "object")) {
    return;
  }

  const callbackURL = Reflect.get(ctx.body, "callbackURL");
  if (callbackURL === undefined) {
    return;
  }

  if (typeof callbackURL !== "string" || !isSafeAuthCallbackPath(callbackURL)) {
    throw APIError.from("BAD_REQUEST", {
      code: "INVALID_CALLBACK_URL",
      message: "callbackURL must be a same-site path starting with '/'.",
    });
  }
});

export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  // In production we pin baseURL to the public origin so cookies, magic-link
  // emails, and redirects use the user-facing URL. Locally we leave it unset
  // so better-auth derives the basePath from `options.basePath` and uses the
  // request origin — otherwise its router (which keys off `baseURL.pathname`)
  // strips `/api/auth` from incoming `/v1/auth/...` requests and 404s.
  ...(process.env.NODE_ENV === "production"
    ? { baseURL: publicAuthBaseURL }
    : {}),
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: false,
    camelCase: false,
    schema: authSchema,
  }),
  basePath: "/v1/auth",
  experimental: {
    // Better Auth's drizzle adapter passes raw `eq(col, val)` operators to
    // `db.query.x.findFirst({ where })`, but drizzle-orm 1.0-beta's relational
    // query builder expects a filter callback there — the SQL operator gets
    // walked as a filter object and explodes on its internal `decoder`
    // property. Keep this off until better-auth ships a compatible adapter.
    joins: false,
  },
  hooks: {
    before: enforceSafeCallbackURLBodies,
    after: enforceTwoFactorOnNonStandardSignIns,
  },
  databaseHooks: {
    user: {
      update: {
        before: normalizeUserProfileInput,
      },
    },
  },
  emailAndPassword: {
    enabled: String(process.env.NODE_ENV) === "test",
    autoSignIn: true,
  },
  trustedOrigins,
  appName: "Kayle ID",
  advanced: {
    cookiePrefix: "kayle-id",
    database: {
      generateId: "uuid",
    },
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      partitioned: true,
      path: "/",
    },
    ipAddress: {
      ipAddressHeaders: [...TRUSTED_CLIENT_IP_HEADERS],
    },
  },
  telemetry: {
    debug: false,
    enabled: false,
  },
  user,
  account: {
    modelName: "auth_accounts",
  },
  session: {
    updateAge: 60 * 1000, // 60 seconds
    freshAge: 60 * 60 * 1000, // 1 hour
  },
  verification: {
    modelName: "auth_verifications",
  },
  emailVerification: {
    expiresIn: verifyEmailExpiryInSeconds,
    /**
     * Single handler for all email-verification deliveries — both initial
     * verification (called via `client.sendVerificationEmail`) and the
     * `change-email-verification` token that follows a `client.changeEmail`
     * submission. We branch the email copy on the JWT's `updateTo` claim:
     * if present, this is a change-email confirmation and the address being
     * delivered to *is* the new address.
     */
    sendVerificationEmail: async ({ user: targetUser, url, token }) => {
      if (process.env.NODE_ENV !== "production") {
        return;
      }

      const payload = readEmailVerificationToken(token);
      const isChangeEmail =
        typeof payload?.updateTo === "string" && payload.updateTo.length > 0;

      if (isChangeEmail) {
        await sendChangeEmailVerification({
          binding: env.SEND_EMAIL,
          expiresInMinutes: verifyEmailExpiryInMinutes,
          from: env.EMAIL_FROM_ADDRESS,
          newEmail: targetUser.email,
          to: targetUser.email,
          url,
        });
        return;
      }

      await sendVerifyEmail({
        binding: env.SEND_EMAIL,
        email: targetUser.email,
        expiresInMinutes: verifyEmailExpiryInMinutes,
        from: env.EMAIL_FROM_ADDRESS,
        to: targetUser.email,
        url,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scope: ["profile", "email", "openid"],
      redirectURI: publicGoogleCallbackURL,
    },
  },
  secondaryStorage: {
    get: async (key) => (await redis.get<string>(key)) ?? null,
    set: async (key, value, ttl) => {
      if (ttl) {
        await redis.set(key, value, { ex: ttl });
      } else {
        await redis.set(key, value);
      }
    },
    delete: async (key) => {
      await redis.del(key);
    },
  },
  plugins: [
    ...plugins,
    customSession(
      async ({ user: authUser, session: authSession }) => {
        // Extend the session with more fields
        let activeOrganization: Organization | null = null;
        const activeOrganizationId = getActiveOrganizationId(authSession);

        const orgRows = await db
          .select({
            id: auth_organizations.id,
            name: auth_organizations.name,
            slug: auth_organizations.slug,
            logo: auth_organizations.logo,
            pendingDeletionAt: auth_organizations.pending_deletion_at,
            pendingDeletionRequestedAt:
              auth_organizations.pending_deletion_requested_at,
            pendingDeletionRequestedBy:
              auth_organizations.pending_deletion_requested_by,
            verifiedAt: auth_organizations.verified_at,
            verificationTermsAcceptedAt:
              auth_organizations.verification_terms_accepted_at,
            verificationTermsAcceptedBy:
              auth_organizations.verification_terms_accepted_by,
          })
          .from(auth_organizations)
          .innerJoin(
            auth_organization_members,
            eq(auth_organizations.id, auth_organization_members.organizationId)
          )
          .where(
            and(
              eq(auth_organization_members.userId, authUser.id),
              // Suspended memberships keep the audit-log trail but the user
              // should not see the org in their session's orgs list.
              isNull(auth_organization_members.suspendedAt)
            )
          );

        const organizations: Organization[] = orgRows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          logo: row.logo,
          pendingDeletionAt: row.pendingDeletionAt
            ? row.pendingDeletionAt.toISOString()
            : null,
          pendingDeletionRequestedAt: row.pendingDeletionRequestedAt
            ? row.pendingDeletionRequestedAt.toISOString()
            : null,
          pendingDeletionRequestedBy: row.pendingDeletionRequestedBy,
          verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
          verificationTermsAcceptedAt: row.verificationTermsAcceptedAt
            ? row.verificationTermsAcceptedAt.toISOString()
            : null,
          verificationTermsAcceptedBy: row.verificationTermsAcceptedBy,
        }));

        if (activeOrganizationId) {
          const foundOrg =
            organizations.find((o) => o.id === activeOrganizationId) ??
            organizations[0] ??
            null;
          activeOrganization = foundOrg ? { ...foundOrg } : null;
        }

        return {
          user: {
            ...authUser,
          },
          organizations,
          session: {
            ...authSession,
          },
          activeOrganization,
          isPlatformAdmin: isPlatformAdminOrganization(activeOrganization?.id),
        };
      },
      {
        plugins,
        user,
      }
    ),
  ],
});

export { auth as server };
