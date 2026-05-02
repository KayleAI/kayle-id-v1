import { env as cloudflareEnv } from "cloudflare:workers";
import {
	createRuntimeEnv,
	getImportMetaEnv,
} from "@kayle-id/config/runtime-env";
import { createEnv } from "@t3-oss/env-core";
import { config } from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "production") {
	config({
		path: "../../.env",
		quiet: true,
		debug: false,
	});
}

export const env = createEnv({
	clientPrefix: "PUBLIC_",
	client: {
		/* no client-only variables */
	},

	server: {
		KAYLE_INTERNAL_TOKEN: z.string().min(1),
		KAYLE_DEMO_API_KEY: z.string().min(1).optional(),
		KAYLE_DEMO_ORG_SLUG: z.string().min(1).optional(),

		// Cloudflare Specific Variables
		API: z.custom<Fetcher>(),
		DEMO_RUNS: z.custom<DurableObjectNamespace>().optional(),
	},

	runtimeEnv: createRuntimeEnv(
		typeof process === "undefined" ? undefined : process?.env,
		getImportMetaEnv(import.meta),
		cloudflareEnv,
	),

	emptyStringAsUndefined: true,
});
