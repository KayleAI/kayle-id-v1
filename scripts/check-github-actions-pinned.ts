import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GITHUB_DIR = ".github";
const PINNED_REF = /^[a-f0-9]{40}$/;
const USES_LINE = /^\s*uses:\s*(?<target>\S+)\s*$/;

function listWorkflowFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...listWorkflowFiles(path));
      continue;
    }

    if (path.endsWith(".yml") || path.endsWith(".yaml")) {
      files.push(path);
    }
  }

  return files;
}

function isLocalAction(target: string): boolean {
  return target.startsWith("./") || target.startsWith("../");
}

const root = new URL("..", import.meta.url).pathname;
const failures: string[] = [];

for (const file of listWorkflowFiles(join(root, GITHUB_DIR))) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  for (const [index, line] of lines.entries()) {
    const match = USES_LINE.exec(line);
    const target = match?.groups?.target;

    if (!target || isLocalAction(target)) {
      continue;
    }

    const [, ref] = target.split("@");
    if (!(ref && PINNED_REF.test(ref))) {
      failures.push(`${relative(root, file)}:${index + 1}: ${target}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    [
      "GitHub Actions must be pinned to immutable commit SHAs.",
      "",
      ...failures,
      "",
      "Replace mutable refs such as @v4 with a 40-character commit SHA.",
    ].join("\n")
  );
  process.exit(1);
}
