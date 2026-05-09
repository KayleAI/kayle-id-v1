import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

type PlatformWranglerConfig = {
	vars?: {
		NODE_ENV?: string;
	};
};

test("platform worker config pins production NODE_ENV", async () => {
	const configPath = join(process.cwd(), "wrangler.jsonc");
	const config = JSON.parse(
		await readFile(configPath, "utf8"),
	) as PlatformWranglerConfig;

	expect(config.vars?.NODE_ENV).toBe("production");
});
