import { TRUSTED_CLIENT_IP_HEADERS } from "@kayle-id/config/client-ip";
import { env } from "@kayle-id/config/env";
import { createSafeRequestLogger, logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
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
import { customSession, openAPI, organization } from "better-auth/plugins";
import { eq, inArray } from "drizzle-orm";
import { magic } from "./magic";
import { findSoleOwnedOrganizations } from "./owned-organizations";
import type { Organization } from "./types";

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
    // Deleting an org cascades members, invitations, api_keys, and webhooks
    // via existing FK rules; orgs with co-owners are left intact.
    beforeDelete: async (deletingUser) => {
      const orgs = await findSoleOwnedOrganizations(deletingUser.id);
      if (orgs.length === 0) {
        return;
      }

      await db.delete(auth_organizations).where(
        inArray(
          auth_organizations.id,
          orgs.map((org) => org.id)
        )
      );
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
    schema: {
      invitation: {
        modelName: "auth_invitations",
      },
      organization: {
        modelName: "auth_organizations",
      },
      member: {
        modelName: "auth_organization_members",
      },
      organizationRole: {
        modelName: "auth_organization_roles",
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
] satisfies BetterAuthOptions["plugins"];

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
    // Eventually we'll want to enable joins but for now we're facing an issue with them not.
    joins: false,
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
    modelName: "auth_sessions",
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
  /*...(process.env.NODE_ENV === "production"
    ? // Only enable secondary storage in production
      {
        secondaryStorage: {
          get: async (key) => await redis.get(key),
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
      }
    : {}),*/
  plugins: [
    ...plugins,
    customSession(
      async ({ user: authUser, session: authSession }) => {
        // Extend the session with more fields
        let activeOrganization: Organization | null = null;
        const activeOrganizationId = getActiveOrganizationId(authSession);

        const organizations: Organization[] = await db
          .select({
            id: auth_organizations.id,
            name: auth_organizations.name,
            slug: auth_organizations.slug,
            logo: auth_organizations.logo,
          })
          .from(auth_organizations)
          .innerJoin(
            auth_organization_members,
            eq(auth_organizations.id, auth_organization_members.organizationId)
          )
          .where(eq(auth_organization_members.userId, authUser.id));

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
