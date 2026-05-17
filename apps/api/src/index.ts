import { OpenAPIHono } from "@hono/zod-openapi";
import { processDueOrganizationDeletions } from "@kayle-id/auth/organization-deletion";
import {
	applySecurityHeaders,
	isHttpsRequest,
} from "@kayle-id/config/security-headers";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import {
	runDomainReverificationCron,
	shouldRunDomainReverification,
} from "@/auth/domain-verification/recheck";
import { config } from "@/config";
import internal from "@/internal";
import { requestLoggingMiddleware } from "@/logging";
import { registerWebhookPayloadOpenApi } from "@/openapi/models/webhook";
import { requestBodyLimitMiddleware } from "@/request-body-limit";
import { runStorageAtRestCron } from "@/scheduled/storage-at-rest";
import {
	runVerificationRetentionSweep,
	shouldRunVerificationRetentionSweep,
} from "@/scheduled/verification-retention";
import v1 from "@/v1";
import admin from "@/v1/admin";
import { shouldRunExpiredSessionNormalization } from "@/v1/analytics/session-analytics";
import { normalizeExpiredVerificationSessions } from "@/v1/sessions/repo/session-repo";
import verify from "@/v1/verify";
import {
	refreshAppAttestReceipts,
	shouldRunReceiptRefresh,
} from "@/v1/verify/attest-receipt-refresh";
import { runWebhookPayloadRetentionSweep } from "@/v1/webhooks/deliveries/service";
import auth from "./auth";

export { WebhookDeliveryWorkflow } from "@/v1/webhooks/deliveries/workflow";

const app = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

app.use(async (c, next) => {
	await next();

	applySecurityHeaders(c.res.headers, {
		includeStrictTransportSecurity: isHttpsRequest(c.req.raw),
	});
});
// PUBLIC_AUTH_URL is set per env in wrangler (kayle.id / staging.kayle.id /
// localhost:3000), so it doubles as the CORS-allowed platform origin without
// us having to branch on NODE_ENV here (staging pins NODE_ENV=production).
const corsAllowedOrigin =
	process.env.PUBLIC_AUTH_URL ?? "https://localhost:3000";

// Derive the OpenAPI server URL from PUBLIC_AUTH_URL so staging documents
// `api.staging.kayle.id` instead of `api.kayle.id`. Out of production we fall
// back to the local wrangler dev port.
function resolveOpenApiServerUrl(): string {
	if (process.env.NODE_ENV !== "production") {
		return "http://127.0.0.1:8787";
	}
	try {
		const authUrl = new URL(corsAllowedOrigin);
		return `${authUrl.protocol}//api.${authUrl.hostname}`;
	} catch {
		return "https://api.kayle.id";
	}
}
app.use(
	cors({
		origin: [corsAllowedOrigin],
		allowHeaders: ["Authorization", "Content-Type"],
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		credentials: true,
	}),
);
app.use(requestLoggingMiddleware());
app.use(requestBodyLimitMiddleware);

app.get("/", (c) => {
	const status: "healthy" | "unhealthy" = "healthy";

	return c.json({
		data: {
			message: "Hello from Kayle ID!",
			docs: "https://docs.kayle.id",
			status,
		},
		error: null,
	});
});

// Auth Handlers
app.route("/v1/auth", auth);

// v1
app.route("/v1/verify", verify);
app.route("/v1/admin", admin);
app.route("/v1", v1);

// Platform-only internal endpoints (gated by KAYLE_INTERNAL_TOKEN)
app.route("/internal", internal);

// R2 Emulation — Only for development & testing
if (process.env.NODE_ENV !== "production") {
	app.get("/r2/*", async (c) => {
		const key = c.req.path.substring("/r2/".length);
		const file = await c.env.STORAGE.get(key);

		if (!file) {
			return c.json(
				{
					error: "file not found",
					status: 404,
				},
				404,
			);
		}

		const headers = new Headers();
		headers.append("etag", file.httpEtag);

		return new Response(file.body, {
			headers,
		});
	});
}

// OpenAPI documentation
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
	type: "http",
	scheme: "bearer",
});

registerWebhookPayloadOpenApi(app.openAPIRegistry);

app.doc31("/openapi", {
	info: {
		title: "Kayle ID",
		version: config.version,
		description: "Privacy-first identity verification.",
		license: {
			name: "Apache License 2.0",
			url: "https://github.com/kayleai/kayle-id/blob/main/LICENSE",
		},
		contact: {
			name: "Kayle ID",
			url: "https://kayle.id",
			email: "help@kayle.id",
		},
		termsOfService: "https://kayle.id/terms",
	},
	servers: [
		{
			url: resolveOpenApiServerUrl(),
			description: "",
		},
	],
	security: [{ bearerAuth: [] }],
	openapi: "3.1.0",
});

app.get("/reference", Scalar({ url: "/openapi" }));

const worker = Object.assign(app, {
	fetch: app.fetch.bind(app),
	scheduled: async (
		controller: ScheduledController,
		env: CloudflareBindings,
		_executionCtx: ExecutionContext,
	) => {
		// Daily 00:00 UTC tick — storage-at-rest cost emission only. A
		// rough daily snapshot is enough for the cost dashboard, and a
		// dedicated cron avoids the per-minute gating that the other
		// jobs need. The D1 dedupe row inside `runStorageAtRestCron`
		// remains as belt-and-braces against double-fires on retry.
		if (controller.cron === "0 0 * * *") {
			await runStorageAtRestCron({
				env,
				now: new Date(controller.scheduledTime),
			});
			return;
		}

		if (shouldRunExpiredSessionNormalization(controller.scheduledTime)) {
			await normalizeExpiredVerificationSessions({
				env,
				now: new Date(controller.scheduledTime),
			});
		}

		if (shouldRunReceiptRefresh(controller.scheduledTime)) {
			await refreshAppAttestReceipts({
				env: env as Parameters<typeof refreshAppAttestReceipts>[0]["env"],
				now: new Date(controller.scheduledTime),
			});
		}

		if (shouldRunVerificationRetentionSweep(controller.scheduledTime)) {
			await runVerificationRetentionSweep({
				now: new Date(controller.scheduledTime),
			});
		}

		if (shouldRunDomainReverification(controller.scheduledTime)) {
			await runDomainReverificationCron({
				env: env as Parameters<typeof runDomainReverificationCron>[0]["env"],
				now: new Date(controller.scheduledTime),
			});
		}

		await processDueOrganizationDeletions({
			now: new Date(controller.scheduledTime),
		});

		await runWebhookPayloadRetentionSweep({
			now: new Date(controller.scheduledTime),
		});
	},
});

export default worker;
