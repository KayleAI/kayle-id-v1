import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ORG_VERIFICATIONS_KV_NAMESPACE_ID,
	R2_BUCKET_NAME,
	TRUST_STORE_D1_DATABASE_ID,
} from "./storage-at-rest";

const HERE = dirname(fileURLToPath(import.meta.url));

interface D1Binding {
	binding?: string;
	database_id?: string;
}

interface R2Binding {
	binding?: string;
	bucket_name?: string;
}

interface KvBinding {
	binding?: string;
	id?: string;
}

interface ApiWranglerConfig {
	d1_databases?: D1Binding[];
	r2_buckets?: R2Binding[];
	env?: {
		production?: {
			d1_databases?: D1Binding[];
			r2_buckets?: R2Binding[];
		};
	};
}

interface PlatformWranglerConfig {
	env?: {
		production?: {
			kv_namespaces?: KvBinding[];
		};
	};
}

// JSONC strip — wrangler.jsonc allows `//` line comments which JSON.parse
// chokes on. No block comments or trailing commas live in our wrangler
// files, so a single line-comment pass is enough.
async function readJson<T>(relativePath: string): Promise<T> {
	const raw = await readFile(resolve(HERE, relativePath), "utf8");
	return JSON.parse(raw.replace(/^[ \t]*\/\/.*$/gm, "")) as T;
}

describe("storage-at-rest resource IDs match wrangler.jsonc", () => {
	test("TRUST_STORE_D1_DATABASE_ID matches the api worker's D1 binding (top-level)", async () => {
		const config = await readJson<ApiWranglerConfig>("../../wrangler.jsonc");
		const binding = config.d1_databases?.find(
			(b) => b.binding === "TRUST_STORE",
		);
		expect(binding?.database_id).toBe(TRUST_STORE_D1_DATABASE_ID);
	});

	test("TRUST_STORE_D1_DATABASE_ID matches the api worker's D1 binding (production)", async () => {
		const config = await readJson<ApiWranglerConfig>("../../wrangler.jsonc");
		const binding = config.env?.production?.d1_databases?.find(
			(b) => b.binding === "TRUST_STORE",
		);
		expect(binding?.database_id).toBe(TRUST_STORE_D1_DATABASE_ID);
	});

	test("R2_BUCKET_NAME matches the api worker's R2 binding (top-level)", async () => {
		const config = await readJson<ApiWranglerConfig>("../../wrangler.jsonc");
		const binding = config.r2_buckets?.find((b) => b.binding === "STORAGE");
		expect(binding?.bucket_name).toBe(R2_BUCKET_NAME);
	});

	test("R2_BUCKET_NAME matches the api worker's R2 binding (production)", async () => {
		const config = await readJson<ApiWranglerConfig>("../../wrangler.jsonc");
		const binding = config.env?.production?.r2_buckets?.find(
			(b) => b.binding === "STORAGE",
		);
		expect(binding?.bucket_name).toBe(R2_BUCKET_NAME);
	});

	test("ORG_VERIFICATIONS_KV_NAMESPACE_ID matches the platform worker's KV binding (production)", async () => {
		const config = await readJson<PlatformWranglerConfig>(
			"../../../platform/wrangler.jsonc",
		);
		const binding = config.env?.production?.kv_namespaces?.find(
			(b) => b.binding === "ORG_VERIFICATIONS_KV",
		);
		expect(binding?.id).toBe(ORG_VERIFICATIONS_KV_NAMESPACE_ID);
	});
});
