import { createFileRoute } from "@tanstack/react-router";
import { proxyInternalApiRequest } from "@/utils/proxy-internal-api";

function rewriteAuthRedirectLocation(location: string, host: string): string {
	let redirectUrl: string;

	if (location.startsWith("http://api/v1/auth/")) {
		const publicPath = location.replace("http://api/v1/auth/", "/api/");
		redirectUrl = new URL(publicPath, host).toString();
	} else if (location.startsWith("/v1/auth/")) {
		const publicPath = location.replace("/v1/auth/", "/api/v1/auth/");
		redirectUrl = new URL(publicPath, host).toString();
	} else {
		redirectUrl = new URL(location, host).toString();
	}

	return redirectUrl;
}

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
