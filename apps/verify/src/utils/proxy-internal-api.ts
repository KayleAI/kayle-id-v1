import {
	FORWARDED_CLIENT_IP_HEADER,
	getForwardedClientIp,
} from "@kayle-id/config/client-ip";

function getPublicHost(): string {
	return process.env.NODE_ENV === "production"
		? "https://verify.kayle.id"
		: "https://localhost:2999";
}

export function buildApiProxyUrl(
	requestUrl: string,
	host = getPublicHost(),
): string {
	const url = new URL(requestUrl, host);
	return new URL(`${url.pathname}${url.search}`, "http://api").toString();
}

export function buildProxyHeaders(request: Request): Headers {
	const headers = new Headers(request.headers);
	const clientIp = getForwardedClientIp(request.headers);

	if (clientIp) {
		headers.set(FORWARDED_CLIENT_IP_HEADER, clientIp);
	}

	return headers;
}
