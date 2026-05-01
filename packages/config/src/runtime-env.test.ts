import { describe, expect, test } from "bun:test";
import { collectRuntimeEnv, getImportMetaEnv } from "./runtime-env";

describe("collectRuntimeEnv", () => {
  test("merges object sources in order", () => {
    const result = collectRuntimeEnv(
      { API: "process", PUBLIC_URL: "https://local.test" },
      null,
      { API: "worker", STORAGE: { binding: true } }
    );

    expect(result).toEqual({
      API: "worker",
      PUBLIC_URL: "https://local.test",
      STORAGE: { binding: true },
    });
  });

  test("ignores non-object sources", () => {
    expect(collectRuntimeEnv(undefined, "ignored", 1)).toEqual({});
  });
});

describe("getImportMetaEnv", () => {
  test("reads Vite-style env without a type assertion at the call site", () => {
    const meta = { env: { PUBLIC_API_HOST: "localhost:8787" } };

    expect(getImportMetaEnv(meta)).toEqual({
      PUBLIC_API_HOST: "localhost:8787",
    });
  });
});
