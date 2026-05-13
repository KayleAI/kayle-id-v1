import { spawnSync } from "node:child_process";

const RUNTIME_DIRECTORIES = ["infra/biometric-verifier/src"] as const;

const ALLOW_MARKER = "# allow-print:";

const result = spawnSync(
  "rg",
  ["-n", "--type", "py", "^\\s*print\\(", ...RUNTIME_DIRECTORIES],
  {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  }
);

if (result.error) {
  const message =
    result.error instanceof Error
      ? result.error.message
      : "Unknown error while running rg.";

  process.stderr.write(
    [
      "Failed to run the runtime Python log checker.",
      "",
      "This script requires the `rg` binary from ripgrep to be installed.",
      message,
    ].join("\n")
  );
  process.exit(1);
}

if (result.status === 1) {
  process.exit(0);
}

if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

const offenders = result.stdout
  .split("\n")
  .filter((line) => line.length > 0 && !line.includes(ALLOW_MARKER));

if (offenders.length === 0) {
  process.exit(0);
}

process.stderr.write(
  [
    "Direct print() in runtime Python is not allowed.",
    "",
    offenders.join("\n"),
    "",
    "Route output through emit_log(). If you have a legitimate reason for",
    `a bare print(), add a "${ALLOW_MARKER} <reason>" comment on the same line.`,
  ].join("\n")
);
process.exit(1);
