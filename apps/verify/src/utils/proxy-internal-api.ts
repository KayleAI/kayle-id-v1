import {
	CLIENT_IP_SOURCE_HEADERS,
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

export function isAllowedApiProxyPath(
	requestUrl: string,
	host = getPublicHost(),
): boolean {
	const url = new URL(requestUrl, host);
	return (
		url.pathname === "/v1/verify" || url.pathname.startsWith("/v1/verify/")
	);
}

export function buildProxyHeaders(request: Request): Headers {
	const headers = new Headers(request.headers);
	// Drop the canonical IP header and every upstream source header before
	// resolving them ourselves. The API only trusts FORWARDED_CLIENT_IP_HEADER,
	// so the source headers are useless to anything downstream; forwarding
	// them would let a client whose request bypasses Cloudflare's
	// cf-connecting-ip rewrite get a spoofed IP honoured by code that
	// accidentally reintroduces an ipAddressHeaders fallback chain.
	headers.delete(FORWARDED_CLIENT_IP_HEADER);
	for (const sourceHeader of CLIENT_IP_SOURCE_HEADERS) {
		headers.delete(sourceHeader);
	}

	const clientIp = getForwardedClientIp(request.headers);

	if (clientIp) {
		headers.set(FORWARDED_CLIENT_IP_HEADER, clientIp);
	}

	return headers;
}
