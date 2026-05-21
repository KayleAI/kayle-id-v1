import {
	isHttpsRequest,
	withSecurityHeaders,
} from "@kayle-id/config/security-headers";
import server from "@tanstack/react-start/server-entry";

// TanStack Start types server.fetch as `(request) => ...`, but the Cloudflare
// Workers runtime calls it with (request, env, ctx) and TanStack forwards
// them through. Cast so we can pass env/ctx without dropping them or
// threading them via globals.
type WorkerFetchHandler = (
	request: Request,
	env: CloudflareBindings,
	ctx: ExecutionContext,
) => Promise<Response>;

const tanstackFetch = server.fetch as unknown as WorkerFetchHandler;

async function fetchWithSecurityHeaders(
	request: Request,
	env: CloudflareBindings,
	ctx: ExecutionContext,
): Promise<Response> {
	const response = await tanstackFetch(request, env, ctx);
	return withSecurityHeaders(response, {
		includeStrictTransportSecurity: isHttpsRequest(request),
	});
}

export default {
	fetch: fetchWithSecurityHeaders,
};
