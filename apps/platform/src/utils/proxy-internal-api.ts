import { env } from "@/config/env";
import {
	buildInternalApiProxyUrl,
	buildProxyHeaders,
	getPublicHost,
} from "./proxy-internal-api-utils";

export async function proxyInternalApiRequest({
	request,
	rewriteRedirectLocation,
}: {
	request: Request & { cf?: unknown };
	rewriteRedirectLocation?: (location: string, host: string) => string;
}): Promise<Response> {
	const host = getPublicHost();

	const response = await env.API.fetch(
		buildInternalApiProxyUrl(request.url, host),
		{
			body: request.body ?? undefined,
			credentials: "include",
			headers: buildProxyHeaders(request, env.KAYLE_INTERNAL_TOKEN),
			method: request.method,
			redirect: "manual",
		},
	);

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
