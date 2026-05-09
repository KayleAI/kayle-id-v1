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
