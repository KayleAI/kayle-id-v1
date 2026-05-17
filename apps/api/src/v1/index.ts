import { OpenAPIHono } from "@hono/zod-openapi";
import { requestLoggingMiddleware } from "@/logging";
import analytics from "@/v1/analytics";
import { authenticate, requireReadWriteScope, requireScope } from "@/v1/auth";
import sessions from "@/v1/sessions";
import sessionAttempts from "@/v1/sessions/attempts";
import webhooks from "@/v1/webhooks";
import events from "@/v1/webhooks/events";

const v1 = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

v1.use(requestLoggingMiddleware());

// All v1 routes require authentication
v1.use(authenticate);

// Scope enforcement. API-key callers must hold the scope explicitly;
// session callers must hold the org role mapped to that scope by
// SCOPE_REQUIRED_ROLE in @kayle-id/auth/permissions.
v1.use("/analytics", requireScope("analytics:read"));
v1.use("/analytics/*", requireScope("analytics:read"));
v1.use(
	"/sessions",
	requireReadWriteScope({ read: "sessions:read", write: "sessions:write" }),
);
v1.use(
	"/sessions/*",
	requireReadWriteScope({ read: "sessions:read", write: "sessions:write" }),
);
v1.use(
	"/events",
	requireReadWriteScope({ read: "webhooks:read", write: "webhooks:write" }),
);
v1.use(
	"/events/*",
	requireReadWriteScope({ read: "webhooks:read", write: "webhooks:write" }),
);
v1.use(
	"/webhooks",
	requireReadWriteScope({ read: "webhooks:read", write: "webhooks:write" }),
);
v1.use(
	"/webhooks/*",
	requireReadWriteScope({ read: "webhooks:read", write: "webhooks:write" }),
);

// v1 routes
v1.route("/analytics", analytics);
v1.route("/events", events);
v1.route("/sessions", sessionAttempts);
v1.route("/sessions", sessions);
v1.route("/webhooks", webhooks);

export default v1;
