import { expect, test } from "bun:test";

type ApiWranglerConfig = {
	routes?: Array<{
		custom_domain?: boolean;
		pattern?: string;
		zone_name?: string;
	}>;
	vars?: {
		NODE_ENV?: string;
	};
	env?: {
		production?: {
			routes?: Array<{
				custom_domain?: boolean;
				pattern?: string;
				zone_name?: string;
			}>;
			secrets?: {
				required?: string[];
			};
			vars?: {
				NODE_ENV?: string;
			};
		};
		test?: {
			secrets?: {
				required?: string[];
			};
			vars?: {
				NODE_ENV?: string;
			};
		};
	};
};

test("api worker config pins NODE_ENV for every deploy target", async () => {
	const config = (await Bun.file(
		new URL("../../wrangler.jsonc", import.meta.url),
	).json()) as ApiWranglerConfig;

	expect(config.vars?.NODE_ENV).toBe("development");
	expect(config.env?.production?.vars?.NODE_ENV).toBe("production");
	expect(config.env?.test?.vars?.NODE_ENV).toBe("test");
});

test("api worker only binds production routes in the production deploy target", async () => {
	const config = (await Bun.file(
		new URL("../../wrangler.jsonc", import.meta.url),
	).json()) as ApiWranglerConfig;

	expect(config.vars?.NODE_ENV).toBe("development");
	expect(config.routes).toBeUndefined();
	expect(config.env?.production?.routes).toEqual([
		{
			pattern: "api.kayle.id",
			zone_name: "kayle.id",
			custom_domain: true,
		},
		{
			pattern: "api.kayle.id/*",
			zone_name: "kayle.id",
			custom_domain: false,
		},
	]);
});

test("api worker deploy config requires Redis credentials", async () => {
	const config = (await Bun.file(
		new URL("../../wrangler.jsonc", import.meta.url),
	).json()) as ApiWranglerConfig;

	expect(config.env?.production?.secrets?.required).toContain("REDIS_URL");
	expect(config.env?.production?.secrets?.required).toContain("REDIS_TOKEN");
	expect(config.env?.test?.secrets?.required).toContain("REDIS_URL");
	expect(config.env?.test?.secrets?.required).toContain("REDIS_TOKEN");
});
