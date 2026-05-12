import type {
  Hyperdrive,
  R2Bucket,
  SendEmail,
} from "@cloudflare/workers-types";
import { createEnv } from "@t3-oss/env-core";
import { config } from "dotenv";
import { z } from "zod";
import { createRuntimeEnv, getImportMetaEnv } from "./runtime-env";

if (process.env.NODE_ENV !== "production") {
  config({
    path: "../../../.env",
    quiet: true,
    debug: false,
  });
}

let cloudflareEnv: unknown;

try {
  const cf = "cloudflare:workers";
  cloudflareEnv = (await import(/* @vite-ignore */ cf))?.env;
} catch {
  // ignore
}

export const env = createEnv({
  clientPrefix: "PUBLIC_",
  client: {
    /* no client-only variables */
  },

  server: {
    KAYLE_INTERNAL_TOKEN: z.string().min(1),
    AUTH_SECRET: z.string().min(1),

    // The single organization with platform-admin access (e.g. the in-app
    // approvals dashboard at /admin). Hard-coded by env so it cannot be
    // flipped via DB write — even with database access, an attacker would
    // need worker-secret access to escalate. Optional in dev/test.
    KAYLE_ORGANIZATION_ID: z.string().uuid().optional(),

    // Google OAuth
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),

    // Better Auth stores sessions and other ephemeral state in Redis via the
    // Upstash REST client, so both must be set in every environment.
    REDIS_URL: z.string().min(1),
    REDIS_TOKEN: z.string().min(1),

    // Email
    EMAIL_FROM_ADDRESS: z.string().min(1),

    // Cloudflare Specific Variables
    STORAGE: z.custom<R2Bucket>(),
    HYPERDRIVE: z.custom<Hyperdrive>().optional(),
    SEND_EMAIL: z.custom<SendEmail>(),
  },

  shared: {
    PUBLIC_AUTH_URL: z.string().min(1),

    PUBLIC_DEVELOPMENT_API_BASE_URL: z.string().url().optional(),
  },

  runtimeEnv: createRuntimeEnv(
    typeof process === "undefined" ? undefined : process?.env,
    getImportMetaEnv(import.meta),
    cloudflareEnv
  ),

  emptyStringAsUndefined: true,

  // Skip validation in test environment
  skipValidation: (process.env.NODE_ENV as string) === "test",
});
