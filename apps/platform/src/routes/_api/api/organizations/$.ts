import { createFileRoute } from "@tanstack/react-router";
import { proxyOrganizationsApiRequest } from "./-proxy";

export const Route = createFileRoute("/_api/api/organizations/$")({
	server: {
		handlers: {
			ANY: ({ request }) => proxyOrganizationsApiRequest(request),
		},
	},
});
