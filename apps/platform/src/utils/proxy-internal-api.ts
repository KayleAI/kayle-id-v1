import { env } from "@/config/env";
import {
	buildInternalApiProxyUrl,
	buildProxyHeaders,
	getPublicHost,
	InternalApiProxyPathError,
	type InternalApiProxyRoot,
} from "./proxy-internal-api-utils";

export async function proxyInternalApiRequest({
	request,
	rewriteRedirectLocation,
	root,
}: {
	request: Request & { cf?: unknown };
	rewriteRedirectLocation?: (location: string, host: string) => string;
	root: InternalApiProxyRoot;
}): Promise<Response> {
	const host = getPublicHost();
	let targetUrl: string;
	try {
		targetUrl = buildInternalApiProxyUrl(request.url, root, host);
	} catch (error) {
		if (error instanceof InternalApiProxyPathError) {
			return new Response(null, { status: 404 });
		}

		throw error;
	}

	const response = await env.API.fetch(targetUrl, {
		body: request.body ?? undefined,
		credentials: "include",
		headers: buildProxyHeaders(request, env.KAYLE_INTERNAL_TOKEN),
		method: request.method,
		redirect: "manual",
	});

	if (
		rewriteRedirectLocation &&
		[301, 302, 303, 307, 308].includes(response.status)
	) {
		const location = response.headers.get("Location");

		if (location) {
			const headers = new Headers(response.headers);
			headers.set("Location", rewriteRedirectLocation(location, host));

			return new Response(null, {
				headers,
				status: response.status,
			});
		}
	}

	return new Response(response.body, {
		headers: response.headers,
		status: response.status,
	});
}
