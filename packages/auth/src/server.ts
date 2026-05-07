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
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import {
  customSession,
  openAPI,
  organization,
  twoFactor,
} from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { magic } from "./magic";
import { hardDeleteOrganizations, isOrgFrozen } from "./organization-deletion";
import { findSoleOwnedOrganizations } from "./owned-organizations";
import type { Organization } from "./types";

const TWO_FACTOR_COOKIE_NAME = "two_factor";
const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes
const TWO_FACTOR_VERIFICATION_PREFIX = "2fa-";

// Paths handled outside better-auth's built-in sign-in endpoints (magic-link
// verification + Google OAuth callback). The twoFactor plugin's after-hook
// only matches `/sign-in/email|username|phone-number`, so we re-implement the
// challenge handoff here to keep 2FA enforced on every sign-in path.
const TWO_FACTOR_ENFORCED_PATHS = new Set([
  "/magic/verify-otp",
  "/magic/verify-link",
  "/callback/google",
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
// runs on `kayle.id` in production and `localhost:3000` in development, while
// the auth server itself may sit on a different host (e.g. 127.0.0.1:8787).
const isProduction = process.env.NODE_ENV === "production";
const passkeyRpID = isProduction ? "kayle.id" : "localhost";
const passkeyOrigin = isProduction
  ? "https://kayle.id"
  : ["https://localhost:3000", "https://localhost:8787"];

interface MagicOtpPayload {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification";
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
      // Block org-scoped writes once a deletion is scheduled. Without these
      // hooks an admin/owner could add members, change roles, send invites,
      // or rename the org during the 48h freeze window.
      // biome-ignore lint/suspicious/useAwait: required
      beforeUpdateOrganization: async ({ organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeAddMember: async ({ organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
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
      beforeUpdateMemberRole: async ({ organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeCreateInvitation: async ({ organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
      },
      // biome-ignore lint/suspicious/useAwait: required
      beforeAcceptInvitation: async ({ organization: org }) => {
        if (
          isOrgFrozen(
            org as unknown as { pendingDeletionAt: Date | null | undefined }
          )
        ) {
          throw new Error("Organization is scheduled for deletion.");
        }
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
    after: enforceTwoFactorOnNonStandardSignIns,
  },
  emailAndPassword: {
    enabled: process.env.NODE_ENV === "test",
    autoSignIn: true,
  },
  trustedOrigins: ["https://localhost:3000", "https://kayle.id"],
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
          .where(eq(auth_organization_members.userId, authUser.id));

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
