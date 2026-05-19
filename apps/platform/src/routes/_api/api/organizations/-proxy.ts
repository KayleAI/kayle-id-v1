import { env } from "@/config/env";
import {
	buildProxyHeaders,
	getPublicHost,
} from "@/utils/proxy-internal-api-utils";

const ORGANIZATIONS_API_PREFIX = "/api/organizations";

function buildOrganizationsProxyUrl(
	requestUrl: string,
	host = getPublicHost(),
) {
	const url = new URL(requestUrl, host);

	if (
		!(
			url.pathname === ORGANIZATIONS_API_PREFIX ||
			url.pathname.startsWith(`${ORGANIZATIONS_API_PREFIX}/`)
		)
	) {
		return null;
	}

	const suffix = url.pathname
		.slice(ORGANIZATIONS_API_PREFIX.length)
		.replace(/\/+$/g, "");
	const targetPath = `/v1/verify/organizations${suffix}`;

	return new URL(`${targetPath}${url.search}`, "http://api").toString();
}

export async function proxyOrganizationsApiRequest(
	request: Request & { cf?: unknown },
): Promise<Response> {
	const targetUrl = buildOrganizationsProxyUrl(request.url);

	if (!targetUrl) {
		return new Response(null, { status: 404 });
	}

	const response = await env.API.fetch(targetUrl, {
		body: request.body ?? undefined,
		credentials: "include",
		headers: buildProxyHeaders(request, env.KAYLE_INTERNAL_TOKEN),
		method: request.method,
		redirect: "manual",
	});

	return new Response(response.body, {
		headers: response.headers,
		status: response.status,
	});
}
