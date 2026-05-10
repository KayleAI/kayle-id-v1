import { OpenAPIHono } from "@hono/zod-openapi";
import { server } from "@kayle-id/auth/server";
import { FORWARDED_CLIENT_IP_HEADER } from "@kayle-id/config/client-ip";
import { env } from "@kayle-id/config/env";
import account from "@/auth/account";
import apiKeys from "@/auth/api-keys";
import {
	resolveTrustedClientIp,
	stripClientProxyHeaders,
} from "@/proxy-client-ip";
import organizations from "./auth/organizations";

const auth = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

export async function buildBetterAuthRequest({
	internalToken,
	request,
	url,
}: {
	internalToken: string;
	request: Request;
	url?: URL;
}): Promise<Request> {
	const sourceHeaders = request.headers;
	const clientIp = await resolveTrustedClientIp({
		headers: sourceHeaders,
		internalToken,
	});
	const nextRequest = new Request(url ?? request.url, request);

	stripClientProxyHeaders(nextRequest.headers);

	if (clientIp) {
		nextRequest.headers.set(FORWARDED_CLIENT_IP_HEADER, clientIp);
	}

	return nextRequest;
}

// Auth Handlers
auth.route("/account", account);
auth.route("/api-keys", apiKeys);
auth.route("/orgs", organizations);

// Membership rows must never be hard-deleted through user-facing flows —
// suspension preserves them so audit-log entries can keep attributing past
// actions. Better-auth's organization plugin still ships a remove-member /
// leave handler that DELETEs the row, so we shadow those paths with a 410
// Gone before the catch-all forwards to better-auth. The platform UI uses
// our `/orgs/members/*` endpoints instead.
const HARD_DELETE_BLOCKED_PAYLOAD = {
	data: null,
	error: {
		code: "MEMBERSHIP_HARD_DELETE_BLOCKED" as const,
		message:
			"This endpoint has been replaced by the suspension flow. Membership rows are preserved so audit-log entries keep attributing past actions to the user.",
		hint: "Use DELETE /v1/auth/orgs/members/{id} (admin/owner) or POST /v1/auth/orgs/members/leave (self).",
		docs: "https://kayle.id/docs/api/errors#gone",
	},
} as const;
auth.on(["POST"], "/organization/remove-member", (c) =>
	c.json(HARD_DELETE_BLOCKED_PAYLOAD, 410),
);
auth.on(["POST"], "/organization/leave", (c) =>
	c.json(HARD_DELETE_BLOCKED_PAYLOAD, 410),
);

auth.on(["POST", "GET"], "/*", async (c) => {
	const original = c.req.raw;
	let url: URL | undefined;

	// In production we set better-auth's `baseURL` to `https://kayle.id/api/auth`
	// so cookies and emails use the public URL. Its router then derives
	// basePath = "/api/auth" from that pathname, but the platform proxy hands
	// us `/v1/auth/...` — so we rewrite the pathname here to match. Outside
	// production the auth config leaves `baseURL` unset and routes off
	// `/v1/auth` directly, so no rewrite is needed.
	if (process.env.NODE_ENV === "production") {
		url = new URL(original.url);
		url.pathname = url.pathname.replace(/^\/v1\/auth/, "/api/auth");
	}

	return server.handler(
		await buildBetterAuthRequest({
			internalToken: env.KAYLE_INTERNAL_TOKEN,
			request: original,
			url,
		}),
	);
});

export default auth;
