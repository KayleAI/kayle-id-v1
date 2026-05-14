import { createHmac } from "node:crypto";
import {
	CLIENT_IP_SOURCE_HEADERS,
	FORWARDED_CLIENT_IP_HEADER,
	getForwardedClientIp,
} from "@kayle-id/config/client-ip";

type ProxyRequest = Request & { cf?: unknown };
export type InternalApiProxyRoot = "admin" | "analytics" | "auth" | "webhooks";

export class InternalApiProxyPathError extends Error {
	constructor() {
		super("internal_api_proxy_path_mismatch");
		this.name = "InternalApiProxyPathError";
	}
}

export function getPublicHost(): string {
	return process.env.NODE_ENV === "production"
		? "https://kayle.id"
		: "https://localhost:3000";
}

export function buildInternalApiProxyUrl(
	requestUrl: string,
	root: InternalApiProxyRoot,
	host = getPublicHost(),
): string {
	const url = new URL(requestUrl, host);
	const sourcePrefix = `/api/${root}`;

	if (
		!(
			url.pathname === sourcePrefix ||
			url.pathname.startsWith(`${sourcePrefix}/`)
		)
	) {
		throw new InternalApiProxyPathError();
	}

	const suffix = url.pathname.slice(sourcePrefix.length);
	const targetPath = `v1/${root}${suffix}`
		.replace(/\/+$/g, "")
		.replace(/\/\/+/g, "/");

	return new URL(`/${targetPath}${url.search}`, "http://api").toString();
}

export function buildProxyHeaders(
	request: ProxyRequest,
	internalToken: string,
): Headers {
	const headers = new Headers(request.headers);
	// Strip every client-controllable trusted-proxy header so we can replace
	// them with values we derive ourselves. Without this:
	//   - x-cf-geolocation / x-cf-signature could pass through unsigned when
	//     `request.cf` is missing, and the API would still see them;
	//   - x-real-ip / x-forwarded-for could sit alongside
	//     x-forwarded-client-ip and be picked up by anything that still falls
	//     back to source headers.
	headers.delete(FORWARDED_CLIENT_IP_HEADER);
	headers.delete("x-cf-geolocation");
	headers.delete("x-cf-signature");
	for (const sourceHeader of CLIENT_IP_SOURCE_HEADERS) {
		headers.delete(sourceHeader);
	}

	const cf =
		request.cf && typeof request.cf === "object"
			? JSON.stringify(request.cf)
			: null;

	if (cf) {
		const cfSignature = createHmac("sha256", internalToken)
			.update(cf)
			.digest("hex");

		headers.set("x-cf-geolocation", btoa(cf));
		headers.set("x-cf-signature", cfSignature);
	}

	const clientIp = getForwardedClientIp(request.headers);

	if (clientIp) {
		headers.set(FORWARDED_CLIENT_IP_HEADER, clientIp);
	}

	return headers;
}
