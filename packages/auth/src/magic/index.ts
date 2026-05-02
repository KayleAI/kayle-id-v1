import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import type { User } from "better-auth/types";
import { APIError } from "better-call";
import { z } from "zod";

interface MagicOptions {
  disableSignUp?: boolean;
  expiresIn?: number;
  otpLength?: number;
  rateLimit?: {
    window: number;
    max: number;
  };
  sendMagicOtpAuth: (
    data: {
      /**
       * The email to send the magic link to
       */
      email: string;
      /**
       * The URL to send the magic link to
       */
      url: string;
      /**
       * The OTP to send to the user
       */
      otp: string;
      /**
       * The type of magic link to send
       */
      type: "sign-in" | "email-verification";
    },
    request?: Request
  ) => Promise<void> | void;
}

interface MagicAdapterContext {
  context: {
    internalAdapter: {
      findUserByEmail: (email: string) => Promise<unknown>;
      createUser: (input: {
        email: string;
        emailVerified: boolean;
        name: string;
      }) => Promise<unknown>;
      updateUser: (
        userId: string,
        input: {
          emailVerified: boolean;
        }
      ) => Promise<unknown>;
      deleteVerificationByIdentifier: (identifier: string) => Promise<unknown>;
    };
  };
}

const invalidMagicLinkMessage =
  "Your link is invalid or has expired. Please try again.";

const SCHEME_PATH_PATTERN = /^\/[a-z][a-z0-9+.-]*:/i;

/**
 * Returns true when `input` is safe to redirect to from a magic-link callback —
 * i.e. it is a same-site relative path. Absolute URLs, protocol-relative paths
 * (`//evil.example`), backslash-prefixed paths (`/\evil.example`), and
 * scheme-prefixed paths (`/javascript:foo`) are rejected to close the
 * post-login open-redirect surface.
 */
export function isSafeMagicCallback(input: string): boolean {
  if (!input.startsWith("/")) {
    return false;
  }

  if (input.startsWith("//") || input.startsWith("/\\")) {
    return false;
  }

  if (SCHEME_PATH_PATTERN.test(input)) {
    return false;
  }

  return true;
}

const callbackURLSchema = z
  .string()
  .refine(isSafeMagicCallback, {
    message: "callbackURL must be a same-site path starting with '/'.",
  })
  .optional();

const magicLinkTokenValueSchema = z.object({
  email: z.string().email(),
  type: z.enum(["sign-in", "email-verification"]),
});

function isUserShape(value: unknown): value is User {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const maybeUser = value as {
    id?: unknown;
    email?: unknown;
    emailVerified?: unknown;
    name?: unknown;
  };

  return (
    typeof maybeUser.id === "string" &&
    typeof maybeUser.email === "string" &&
    typeof maybeUser.emailVerified === "boolean" &&
    typeof maybeUser.name === "string"
  );
}

function toUser(value: unknown): User | null {
  if (isUserShape(value)) {
    return value;
  }

  if (typeof value === "object" && value !== null && "user" in value) {
    const maybeUser = (value as { user?: unknown }).user;
    return isUserShape(maybeUser) ? maybeUser : null;
  }

  return null;
}

export function parseMagicLinkTokenValue(
  value: string
): z.infer<typeof magicLinkTokenValueSchema> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new APIError("BAD_REQUEST", {
      message: invalidMagicLinkMessage,
    });
  }

  const result = magicLinkTokenValueSchema.safeParse(parsed);

  if (!result.success) {
    throw new APIError("BAD_REQUEST", {
      message: invalidMagicLinkMessage,
    });
  }

  return result.data;
}

export function shouldRateLimitMagicPath(path: string): boolean {
  return (
    path.startsWith("/magic/sign-in") ||
    path.startsWith("/magic/verify-link") ||
    path.startsWith("/magic/verify-otp")
  );
}

// Compares two strings without short-circuiting on the first mismatching
// byte, so an attacker cannot learn which OTP digits matched by measuring
// per-attempt response time.
//
// The length-mismatch path returns immediately because the OTP length is a
// public configuration value (`magic({ otpLength })`), not a secret. If the
// caller's OTP is the wrong length we already know it is invalid and there is
// nothing useful to leak.
//
// The bitwise XOR/OR pair is the standard constant-time accumulator and is
// intentional despite the project-wide ban on bitwise operators.
export function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time XOR/OR accumulator
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

export function createMagicVerifyLinkUrl({
  baseURL,
  callbackURL = "/",
  token,
}: {
  baseURL: string;
  callbackURL?: string;
  token: string;
}): string {
  const base = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  const url = new URL("magic/verify-link", base);
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", callbackURL);
  return url.toString();
}

export const magic = (options: MagicOptions): BetterAuthPlugin => {
  const opts = {
    expiresIn: 300,
    otpLength: 6,
    disableSignUp: false,
    ...options,
  };

  return {
    id: "magic",
    endpoints: {
      signIn: createAuthEndpoint(
        "/magic/sign-in",
        {
          method: "POST",
          requireHeaders: true,
          body: z.object({
            email: z.string().email(),
            type: z.enum(["sign-in", "email-verification"]),
            callbackURL: callbackURLSchema,
          }),
        },
        async (ctx) => {
          const { email, type, callbackURL } = ctx.body;

          if (opts.disableSignUp) {
            const user =
              await ctx.context.internalAdapter.findUserByEmail(email);

            if (!user) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "We couldn't find a user with that email. Please try again.",
              });
            }
          }

          const token = generateRandomString(32, "a-z", "A-Z");
          const otp = generateRandomString(opts.otpLength, "0-9");

          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `link-${token}`,
            value: JSON.stringify({ email, type }),
            expiresAt: new Date(Date.now() + opts.expiresIn * 1000),
          });

          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `otp-${email}`,
            value: otp,
            expiresAt: new Date(Date.now() + opts.expiresIn * 1000),
          });

          const url = createMagicVerifyLinkUrl({
            baseURL: ctx.context.baseURL,
            callbackURL,
            token,
          });

          try {
            await opts.sendMagicOtpAuth({ email, url, otp, type }, ctx.request);
          } catch {
            ctx.context.logger.error("Failed to send magic-otp auth");
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "We couldn't send you a magic link. Please try again.",
            });
          }

          return ctx.json({ status: true });
        }
      ),
      verifyLink: createAuthEndpoint(
        "/magic/verify-link",
        {
          method: "GET",
          query: z.object({
            token: z.string(),
            callbackURL: callbackURLSchema,
          }),
          requireHeaders: true,
        },
        async (ctx) => {
          const { token, callbackURL } = ctx.query;
          const tokenValue =
            await ctx.context.internalAdapter.findVerificationValue(
              `link-${token}`
            );

          if (!tokenValue || tokenValue.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", {
              message: invalidMagicLinkMessage,
            });
          }

          const { email, type } = parseMagicLinkTokenValue(tokenValue.value);

          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            `link-${token}`
          );

          const user = await handleUserCreationOrUpdate(ctx, opts, email, type);

          const session = await ctx.context.internalAdapter.createSession(
            user.id
          );
          await setSessionCookie(ctx, { session, user });

          if (callbackURL) {
            throw ctx.redirect(callbackURL);
          }

          return ctx.json({ status: true, user, session });
        }
      ),
      verifyOTP: createAuthEndpoint(
        "/magic/verify-otp",
        {
          method: "POST",
          body: z.object({
            email: z.string().email(),
            otp: z.string(),
            type: z.enum(["sign-in", "email-verification"]),
          }),
          requireHeaders: true,
        },
        async (ctx) => {
          const { email, otp, type } = ctx.body;
          const otpValue =
            await ctx.context.internalAdapter.findVerificationValue(
              `otp-${email}`
            );

          const otpExpired = !otpValue || otpValue.expiresAt < new Date();
          const otpMatches =
            !!otpValue && constantTimeStringEqual(otpValue.value, otp);

          if (otpExpired || !otpMatches) {
            // Burn the OTP on any failed attempt so a brute-force attacker
            // cannot keep guessing against the same code within the
            // expiry window — they have to trigger a new sign-in (which is
            // rate-limited) to obtain a fresh OTP.
            if (otpValue) {
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                `otp-${email}`
              );
            }

            throw new APIError("BAD_REQUEST", {
              message: "Your OTP is invalid or has expired. Please try again.",
            });
          }

          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            `otp-${email}`
          );

          const user = await handleUserCreationOrUpdate(ctx, opts, email, type);

          const session = await ctx.context.internalAdapter.createSession(
            user.id
          );

          await setSessionCookie(ctx, { session, user });

          return ctx.json({ status: true, user, session });
        }
      ),
    },
    rateLimit: [
      {
        pathMatcher(path) {
          return shouldRateLimitMagicPath(path);
        },
        window: opts.rateLimit?.window ?? 60,
        max: opts.rateLimit?.max ?? 5,
      },
    ],
  };
};

async function handleUserCreationOrUpdate(
  ctx: MagicAdapterContext,
  opts: MagicOptions,
  email: string,
  type: "sign-in" | "email-verification"
): Promise<User> {
  const existingUser = toUser(
    await ctx.context.internalAdapter.findUserByEmail(email)
  );
  let user = existingUser;

  if (!user) {
    if (opts.disableSignUp) {
      throw new APIError("BAD_REQUEST", {
        message: "We couldn't find a user with that email. Please try again.",
      });
    }
    const createdUser = toUser(
      await ctx.context.internalAdapter.createUser({
        email,
        // The email is always verified when using magic links or entering the code
        emailVerified: true,
        name: "",
      })
    );

    if (!createdUser) {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create user for magic auth.",
      });
    }

    user = createdUser;
  } else if (type === "email-verification") {
    const updatedUser = toUser(
      await ctx.context.internalAdapter.updateUser(user.id, {
        emailVerified: true,
      })
    );

    if (!updatedUser) {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "Failed to update user for email verification.",
      });
    }

    user = updatedUser;
  }

  return user;
}
