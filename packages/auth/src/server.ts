import { TRUSTED_CLIENT_IP_HEADERS } from "@kayle-id/config/client-ip";
import { env } from "@kayle-id/config/env";
import { createSafeRequestLogger, logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
//import { redis } from "@kayle-id/database/redis";
import { auth as authSchema } from "@kayle-id/database/schema";
import {
  auth_organization_members,
  auth_organizations,
} from "@kayle-id/database/schema/auth";
import { sendMagicLinkEmail } from "@kayle-id/emails/send-magic-link-email";
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

const user = {
  modelName: "auth_users",
  deleteUser: {
    // Account deletion needs a product data-retention policy before enabling.
    enabled: false,
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
    // Eventually we'll want to enable joins but for now we're facing an issue with them not.
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
    modelName: "auth_sessions",
    updateAge: 60 * 1000, // 60 seconds
    freshAge: 60 * 60 * 1000, // 1 hour
  },
  verification: {
    modelName: "auth_verifications",
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
