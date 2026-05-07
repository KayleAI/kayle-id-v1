import { mock } from "bun:test";

// `cloudflare:workers` is a virtual module that only exists inside workerd.
// `bun test` runs in plain Bun and can't resolve it, so any source file that
// imports from it (e.g. the `WebhookDeliveryWorkflow` Workflow entrypoint) blows
// up at module-load time before tests start. Provide a runtime-shaped stub here
// — types come from `cloudflare-env.d.ts`, so we only need a class with the
// right constructor signature for `extends WorkflowEntrypoint<...>` to work at
// import time.
mock.module("cloudflare:workers", () => ({
	WorkflowEntrypoint: class {
		// biome-ignore lint/suspicious/noExplicitAny: stub; not invoked in tests.
		ctx: any;
		// biome-ignore lint/suspicious/noExplicitAny: stub; not invoked in tests.
		env: any;
		// biome-ignore lint/suspicious/noExplicitAny: stub; not invoked in tests.
		constructor(ctx?: any, env?: any) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));
