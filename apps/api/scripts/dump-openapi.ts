// Snapshots the API's OpenAPI document for the docs site.
//
// Reads from a running local API at http://127.0.0.1:8787 (start it with
// `bun run dev`), normalizes a few quirks of the @hono/zod-openapi output so
// Mintlify can validate the spec, and writes the result to stdout.
//
// Usage (from the repo root):
//   bun ./apps/api/scripts/dump-openapi.ts > docs/api-reference/openapi.json
const API_URL =
	process.env.KAYLE_OPENAPI_URL ?? "http://127.0.0.1:8787/openapi";

const response = await fetch(API_URL);
if (!response.ok) {
	throw new Error(
		`Failed to fetch OpenAPI from ${API_URL}: ${response.status} ${response.statusText}`,
	);
}

const spec = (await response.json()) as Record<string, unknown>;

// Mintlify's validator rejects bare `nullable: true` schemas (no type) and
// expects OpenAPI 3.1 reference semantics. Normalize both before writing.
spec.openapi = "3.1.0";

const HONO_PATH_PARAM = /:([a-zA-Z_]+)/g;
function rewritePathParams(
	paths: Record<string, unknown>,
): Record<string, unknown> {
	const rewritten: Record<string, unknown> = {};
	for (const [path, item] of Object.entries(paths)) {
		rewritten[path.replace(HONO_PATH_PARAM, "{$1}")] = item;
	}
	return rewritten;
}

if (typeof spec.paths === "object" && spec.paths !== null) {
	spec.paths = rewritePathParams(spec.paths as Record<string, unknown>);
}

function patchEnvelopeErrorField(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(patchEnvelopeErrorField);
	}
	if (node === null || typeof node !== "object") {
		return node;
	}
	const obj = node as Record<string, unknown>;
	const keys = Object.keys(obj);
	const isBareNullable =
		keys.length === 1 && keys[0] === "nullable" && obj.nullable === true;
	if (isBareNullable) {
		return { type: "object", nullable: true, additionalProperties: true };
	}
	const patched: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		patched[key] = patchEnvelopeErrorField(value);
	}
	return patched;
}

spec.paths = patchEnvelopeErrorField(spec.paths);

console.log(JSON.stringify(spec, null, 2));
