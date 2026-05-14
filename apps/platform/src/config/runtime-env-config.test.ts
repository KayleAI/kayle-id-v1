import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

type EnvVars = { NODE_ENV?: string };
type PlatformWranglerConfig = {
	env?: {
		production?: { vars?: EnvVars };
		staging?: { vars?: EnvVars };
	};
};

test("platform worker config pins production NODE_ENV for every deploy env", async () => {
	const configPath = join(process.cwd(), "wrangler.jsonc");
	const config = JSON.parse(
		await readFile(configPath, "utf8"),
	) as PlatformWranglerConfig;

	expect(config.env?.production?.vars?.NODE_ENV).toBe("production");
	expect(config.env?.staging?.vars?.NODE_ENV).toBe("production");
});
