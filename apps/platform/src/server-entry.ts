import server from "@tanstack/react-start/server-entry";
import { DemoRunMailbox as WorkerDemoRunMailbox } from "@/demo/run-mailbox";

export const DemoRunMailbox = WorkerDemoRunMailbox;

const CUSTOM_HOST = "kayle.id";
const MINTLIFY_HOST = "kayleinc.mintlify.app";

export default {
	async fetch(
		request: Request,
		_env: CloudflareBindings,
		_ctx: ExecutionContext,
	) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/docs")) {
			const proxyUrl = new URL(request.url);
			proxyUrl.hostname = MINTLIFY_HOST;

			const proxyRequest = new Request(proxyUrl, request);
			proxyRequest.headers.set("Host", MINTLIFY_HOST);
			proxyRequest.headers.set("X-Forwarded-Host", CUSTOM_HOST);
			proxyRequest.headers.set("X-Forwarded-Proto", "https");

			const connectingIp = request.headers.get("CF-Connecting-IP");
			if (connectingIp) {
				proxyRequest.headers.set("CF-Connecting-IP", connectingIp);
			}

			return fetch(proxyRequest);
		}

		return server.fetch(request);
	},
};
