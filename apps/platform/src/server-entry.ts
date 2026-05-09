import {
	isHttpsRequest,
	withSecurityHeaders,
} from "@kayle-id/config/security-headers";
import server from "@tanstack/react-start/server-entry";
import { DemoRunMailbox as WorkerDemoRunMailbox } from "@/demo/run-mailbox";

export const DemoRunMailbox = WorkerDemoRunMailbox;

async function fetchWithSecurityHeaders(
	request: Request,
	env: CloudflareBindings,
	ctx: ExecutionContext,
): Promise<Response> {
	const response = await server.fetch(request, env, ctx);

	return withSecurityHeaders(response, {
		includeStrictTransportSecurity: isHttpsRequest(request),
	});
}

export default {
	fetch: fetchWithSecurityHeaders,
};
