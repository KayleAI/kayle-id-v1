import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

type EnvVars = { NODE_ENV?: string };
type KvBinding = { binding?: string };
type PlatformWranglerConfig = {
	kv_namespaces?: KvBinding[];
	env?: {
		production?: { kv_namespaces?: KvBinding[]; vars?: EnvVars };
		staging?: { kv_namespaces?: KvBinding[]; vars?: EnvVars };
	};
};

// JSONC strip — wrangler.jsonc allows `//` line comments which JSON.parse
// chokes on. No block comments or trailing commas live in our wrangler
// files, so a single line-comment pass is enough.
function parseJsonc<T>(raw: string): T {
	return JSON.parse(raw.replace(/^[ \t]*\/\/.*$/gm, "")) as T;
}

test("platform worker config pins production NODE_ENV for every deploy env", async () => {
	const configPath = join(process.cwd(), "wrangler.jsonc");
	const config = parseJsonc<PlatformWranglerConfig>(
		await readFile(configPath, "utf8"),
	);

	expect(config.env?.production?.vars?.NODE_ENV).toBe("production");
	expect(config.env?.staging?.vars?.NODE_ENV).toBe("production");
});

test("platform worker config binds org verification KV in every runtime env", async () => {
	const configPath = join(process.cwd(), "wrangler.jsonc");
	const config = parseJsonc<PlatformWranglerConfig>(
		await readFile(configPath, "utf8"),
	);

	const hasOrgVerificationKv = (binding: KvBinding): boolean =>
		binding.binding === "ORG_VERIFICATIONS_KV";

	expect(config.kv_namespaces?.some(hasOrgVerificationKv)).toBe(true);
	expect(
		config.env?.production?.kv_namespaces?.some(hasOrgVerificationKv),
	).toBe(true);
	expect(config.env?.staging?.kv_namespaces?.some(hasOrgVerificationKv)).toBe(
		true,
	);
});
