import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env.server";
import {
	buildApiProxyUrl,
	buildProxyHeaders,
} from "@/utils/proxy-internal-api";

export const Route = createFileRoute("/v1/$")({
	server: {
		handlers: {
			ANY: async ({ request }) => {
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
