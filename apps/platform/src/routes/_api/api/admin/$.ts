import { createFileRoute } from "@tanstack/react-router";
import { proxyInternalApiRequest } from "@/utils/proxy-internal-api";

// Catch-all proxy: `/api/admin/<rest>` → `/v1/admin/<rest>` on the API
// Worker via the existing service binding. The API enforces the
// `requirePlatformAdmin` middleware, so platform-side auth is just
// "forward the cookie".
export const Route = createFileRoute("/_api/api/admin/$")({
	server: {
		handlers: {
			ANY: ({ request }) =>
				proxyInternalApiRequest({
					request,
					root: "admin",
				}),
		},
	},
});
