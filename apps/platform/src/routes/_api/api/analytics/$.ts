import { createFileRoute } from "@tanstack/react-router";
import { proxyInternalApiRequest } from "@/utils/proxy-internal-api";

export const Route = createFileRoute("/_api/api/analytics/$")({
	server: {
		handlers: {
			ANY: ({ request }) =>
				proxyInternalApiRequest({
					request,
					root: "analytics",
				}),
		},
	},
});
