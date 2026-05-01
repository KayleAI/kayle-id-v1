import { createHmac } from "node:crypto";

type ProxyRequest = Request & { cf?: unknown };

export function getPublicHost(): string {
	return process.env.NODE_ENV === "production"
		? "https://kayle.id"
		: "https://localhost:3000";
}

function getForwardedClientIp(request: Request): string | undefined {
	return (
		request.headers.get("cf-connecting-ip") ||
		request.headers.get("x-real-ip") ||
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
	);
}

export function buildInternalApiProxyUrl(
	requestUrl: string,
	host = getPublicHost(),
): string {
	const url = new URL(requestUrl, host);
	const targetPath = `v1/${url.pathname.replace("/api/", "")}`
		.replace(/\/+$/g, "")
		.replace(/\/\/+/g, "/");

	return new URL(`/${targetPath}${url.search}`, "http://api").toString();
}

export function buildProxyHeaders(
	request: ProxyRequest,
	internalToken: string,
): Headers {
	const headers = new Headers(request.headers);
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

	const clientIp = getForwardedClientIp(request);

	if (clientIp) {
		headers.set("x-forwarded-client-ip", clientIp);
	}

	return headers;
}
