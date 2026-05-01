function getPublicHost(): string {
	return process.env.NODE_ENV === "production"
		? "https://verify.kayle.id"
		: "https://localhost:2999";
}

function getForwardedClientIp(request: Request): string | undefined {
	return (
		request.headers.get("cf-connecting-ip") ||
		request.headers.get("x-real-ip") ||
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
	);
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
	const clientIp = getForwardedClientIp(request);

	if (clientIp) {
		headers.set("x-forwarded-client-ip", clientIp);
	}

	return headers;
}
