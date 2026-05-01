import { createFileRoute } from "@tanstack/react-router";
import { rewriteAuthRedirectLocation } from "@/utils/auth-redirects";
import { proxyInternalApiRequest } from "@/utils/proxy-internal-api";

export const Route = createFileRoute("/_api/api/auth/$")({
	server: {
		handlers: {
			ANY: ({ request }) =>
				proxyInternalApiRequest({
					request,
					rewriteRedirectLocation: rewriteAuthRedirectLocation,
				}),
		},
	},
});
