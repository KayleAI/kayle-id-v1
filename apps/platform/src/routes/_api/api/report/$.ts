import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import {
	buildProxyHeaders,
	getPublicHost,
} from "@/utils/proxy-internal-api-utils";

const REPORT_API_PREFIX = "/api/report";

function buildReportProxyUrl(requestUrl: string, host = getPublicHost()) {
	const url = new URL(requestUrl, host);

	if (
		!(
			url.pathname === REPORT_API_PREFIX ||
			url.pathname.startsWith(`${REPORT_API_PREFIX}/`)
		)
	) {
		return null;
	}

	const suffix = url.pathname
		.slice(REPORT_API_PREFIX.length)
		.replace(/\/+$/g, "");
	let targetPath: string | null = null;

	if (suffix === "/organizations") {
		targetPath = "/v1/verify/report-organizations";
	} else if (suffix.startsWith("/organizations/")) {
		targetPath = `/v1/verify/report-organizations${suffix.slice(
			"/organizations".length,
		)}`;
	} else if (suffix === "/organization-reports") {
		targetPath = "/v1/verify/organization-reports";
	}

	if (!targetPath) {
		return null;
	}

	return new URL(`${targetPath}${url.search}`, "http://api").toString();
}

async function proxyReportApiRequest(
	request: Request & { cf?: unknown },
): Promise<Response> {
	const targetUrl = buildReportProxyUrl(request.url);

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

export const Route = createFileRoute("/_api/api/report/$")({
	server: {
		handlers: {
			ANY: ({ request }) => proxyReportApiRequest(request),
		},
	},
});
