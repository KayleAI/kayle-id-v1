import { OpenAPIHono } from "@hono/zod-openapi";
import { server } from "@kayle-id/auth/server";
import {
	CLIENT_IP_SOURCE_HEADERS,
	FORWARDED_CLIENT_IP_HEADER,
	getForwardedClientIp,
} from "@kayle-id/config/client-ip";
import { constantTimeStringEqual } from "@kayle-id/config/constant-time";
import { env } from "@kayle-id/config/env";
import account from "@/auth/account";
import apiKeys from "@/auth/api-keys";
import { createHMAC } from "@/functions/hmac";
import organizations from "./auth/organizations";

const auth = new OpenAPIHono<{ Bindings: CloudflareBindings }>();
const CF_GEOLOCATION_HEADER = "x-cf-geolocation";
const CF_SIGNATURE_HEADER = "x-cf-signature";

function stripClientProxyHeaders(headers: Headers): void {
	headers.delete(FORWARDED_CLIENT_IP_HEADER);
	headers.delete(CF_GEOLOCATION_HEADER);
	headers.delete(CF_SIGNATURE_HEADER);

	for (const header of CLIENT_IP_SOURCE_HEADERS) {
		headers.delete(header);
	}
}

async function hasSignedProxyMetadata(
	headers: Headers,
	internalToken: string,
): Promise<boolean> {
	const encodedCf = headers.get(CF_GEOLOCATION_HEADER);
	const signature = headers.get(CF_SIGNATURE_HEADER);

	if (!(encodedCf && signature)) {
		return false;
	}

	let serializedCf: string;
	try {
		serializedCf = atob(encodedCf);
	} catch {
		return false;
	}

	const expectedSignature = await createHMAC(serializedCf, {
		algorithm: "SHA256",
		secret: internalToken,
	});

	return constantTimeStringEqual(expectedSignature, signature.toLowerCase());
}

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
	const forwardedClientIp = sourceHeaders.get(FORWARDED_CLIENT_IP_HEADER);
	const directClientIp = getForwardedClientIp(sourceHeaders);
	const shouldTrustForwardedClientIp =
		forwardedClientIp &&
		(await hasSignedProxyMetadata(sourceHeaders, internalToken));
	const nextRequest = new Request(url ?? request.url, request);

	stripClientProxyHeaders(nextRequest.headers);

	if (shouldTrustForwardedClientIp) {
		nextRequest.headers.set(FORWARDED_CLIENT_IP_HEADER, forwardedClientIp);
	} else if (directClientIp) {
		nextRequest.headers.set(FORWARDED_CLIENT_IP_HEADER, directClientIp);
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
