import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env.server";
import {
	buildApiProxyUrl,
	buildProxyHeaders,
	isAllowedApiProxyPath,
} from "@/utils/proxy-internal-api";

export const Route = createFileRoute("/v1/$")({
	server: {
		handlers: {
			ANY: async ({ request }) => {
				if (!isAllowedApiProxyPath(request.url)) {
					return Response.json(
						{
							data: null,
							error: {
								code: "NOT_FOUND",
								message: "API route not found.",
							},
						},
						{ status: 404 },
					);
				}

				const response = await env.API.fetch(buildApiProxyUrl(request.url), {
					credentials: "include",
					method: request.method,
					headers: buildProxyHeaders(request),
					body: request.body ?? undefined,
					redirect: "manual",
				});

				return new Response(response.body, {
					status: response.status,
					headers: response.headers,
				});
			},
		},
	},
});
