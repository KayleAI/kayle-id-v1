import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import {
	buildInternalApiProxyUrl,
	buildProxyHeaders,
	getPublicHost,
} from "@/utils/proxy-internal-api-utils";

export const Route = createFileRoute("/_api/api/org-verifications/$")({
	server: {
		handlers: {
			ANY: async ({ request }) => {
				const host = getPublicHost();
				const headers = buildProxyHeaders(
					request as Request & { cf?: unknown },
					env.KAYLE_INTERNAL_TOKEN,
				);
				headers.set("Authorization", `Bearer ${env.KAYLE_INTERNAL_API_KEY}`);

				const response = await env.API.fetch(
					buildInternalApiProxyUrl(request.url, host),
					{
						body: request.body ?? undefined,
						credentials: "include",
						headers,
						method: request.method,
						redirect: "manual",
					},
				);

				return new Response(response.body, {
					headers: response.headers,
					status: response.status,
				});
			},
		},
	},
});
