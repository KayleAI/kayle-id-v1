import { OpenAPIHono } from "@hono/zod-openapi";
import { server } from "@kayle-id/auth/server";
import account from "@/auth/account";
import apiKeys from "@/auth/api-keys";
import organizations from "./auth/organizations";

const auth = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

// Auth Handlers
auth.route("/account", account);
auth.route("/api-keys", apiKeys);
auth.route("/orgs", organizations);
auth.on(["POST", "GET"], "/*", (c) => {
	const original = c.req.raw;

	// In production we set better-auth's `baseURL` to `https://kayle.id/api/auth`
	// so cookies and emails use the public URL. Its router then derives
	// basePath = "/api/auth" from that pathname, but the platform proxy hands
	// us `/v1/auth/...` — so we rewrite the pathname here to match. Outside
	// production the auth config leaves `baseURL` unset and routes off
	// `/v1/auth` directly, so no rewrite is needed.
	if (process.env.NODE_ENV === "production") {
		const url = new URL(original.url);
		url.pathname = url.pathname.replace(/^\/v1\/auth/, "/api/auth");
		return server.handler(new Request(url, original));
	}

	return server.handler(original);
});

export default auth;
