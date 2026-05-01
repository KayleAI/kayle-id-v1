import { env as cloudflareEnv } from "cloudflare:workers";
import { createRuntimeEnv } from "@kayle-id/config/runtime-env";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * This is the root environment variable object that is used to access all the environment variables.
 */
export const env = createEnv({
	server: {
		API: z.custom<Fetcher>(),
	},

	runtimeEnv: createRuntimeEnv(
		typeof process !== "undefined" ? process?.env : undefined,
		cloudflareEnv,
	),

	emptyStringAsUndefined: true,
});
