import { passkey } from "@better-auth/passkey";
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
import { customSession, openAPI, organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { magic } from "./magic";
import type { Organization } from "./types";

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
