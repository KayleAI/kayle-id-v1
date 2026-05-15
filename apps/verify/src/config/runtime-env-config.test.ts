import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

type VerifyWranglerConfig = {
	env?: {
		production?: {
			vars?: {
				NODE_ENV?: string;
				PUBLIC_API_HOST?: string;
				PUBLIC_API_PROTOCOL?: string;
			};
		};
	};
	vars?: {
		NODE_ENV?: string;
		PUBLIC_API_HOST?: string;
		PUBLIC_API_PROTOCOL?: string;
	};
};

// JSONC strip — wrangler.jsonc allows `//` line comments which JSON.parse
// chokes on. No block comments or trailing commas live in our wrangler
// files, so a single line-comment pass is enough.
function parseJsonc<T>(raw: string): T {
	return JSON.parse(raw.replace(/^[ \t]*\/\/.*$/gm, "")) as T;
}

test("verify worker config pins production API runtime env at deploy boundary", async () => {
	const configPath = join(process.cwd(), "wrangler.jsonc");
	const config = parseJsonc<VerifyWranglerConfig>(
		await readFile(configPath, "utf8"),
	);

	expect(config.vars?.NODE_ENV).toBe("production");
	expect(config.vars?.PUBLIC_API_HOST).toBe("api.kayle.id");
	expect(config.vars?.PUBLIC_API_PROTOCOL).toBe("wss");
	expect(config.env?.production?.vars?.NODE_ENV).toBe("production");
	expect(config.env?.production?.vars?.PUBLIC_API_HOST).toBe("api.kayle.id");
	expect(config.env?.production?.vars?.PUBLIC_API_PROTOCOL).toBe("wss");
});
