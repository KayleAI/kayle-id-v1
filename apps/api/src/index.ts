import { OpenAPIHono } from "@hono/zod-openapi";
import { processDueOrganizationDeletions } from "@kayle-id/auth/organization-deletion";
import {
	applySecurityHeaders,
	isHttpsRequest,
} from "@kayle-id/config/security-headers";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { config } from "@/config";
import internal from "@/internal";
import { requestLoggingMiddleware } from "@/logging";
import { requestBodyLimitMiddleware } from "@/request-body-limit";
import v1 from "@/v1";
import { shouldRunExpiredSessionNormalization } from "@/v1/analytics/session-analytics";
import { normalizeExpiredVerificationSessions } from "@/v1/sessions/repo/session-repo";
import verify from "@/v1/verify";
import {
	refreshAppAttestReceipts,
	shouldRunReceiptRefresh,
} from "@/v1/verify/attest-receipt-refresh";
import auth from "./auth";

export { WebhookDeliveryWorkflow } from "@/v1/webhooks/deliveries/workflow";

const app = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

app.use(async (c, next) => {
	await next();

	applySecurityHeaders(c.res.headers, {
		includeStrictTransportSecurity: isHttpsRequest(c.req.raw),
	});
});
app.use(
	cors({
		origin: [
			process.env.NODE_ENV === "production"
				? "https://kayle.id"
				: "https://localhost:3000",
		],
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

app.doc("/openapi", {
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
			url:
				process.env.NODE_ENV === "production"
					? "https://api.kayle.id"
					: "http://127.0.0.1:8787",
			description: "",
		},
	],
	security: [{ bearerAuth: [] }],
	openapi: "3.0.0",
});

app.get("/reference", Scalar({ url: "/openapi" }));

const worker = Object.assign(app, {
	fetch: app.fetch.bind(app),
	scheduled: async (
		controller: ScheduledController,
		env: CloudflareBindings,
		_executionCtx: ExecutionContext,
	) => {
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

		await processDueOrganizationDeletions({
			now: new Date(controller.scheduledTime),
		});
	},
});

export default worker;
