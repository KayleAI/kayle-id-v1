type EnvCoreRuntimeEnv = Record<string, string | number | boolean | undefined>;

export function collectRuntimeEnv(
  ...sources: readonly unknown[]
): Record<string, unknown> {
  const runtimeEnv: Record<string, unknown> = {};

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      runtimeEnv[key] = value;
    }
  }

  return runtimeEnv;
}

export function createRuntimeEnv(
  ...sources: readonly unknown[]
): EnvCoreRuntimeEnv {
  // env-core's runtimeEnv type models primitives, but Cloudflare bindings are
  // object capabilities that z.custom validates at runtime.
  return collectRuntimeEnv(...sources) as EnvCoreRuntimeEnv;
}

export function getImportMetaEnv(meta: object): unknown {
  return Reflect.get(meta, "env");
}
