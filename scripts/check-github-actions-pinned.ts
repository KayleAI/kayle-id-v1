import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GITHUB_DIR = ".github";
const EXACT_NPM_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/;
const IMAGE_LINE = /^\s*image:\s*(?<target>\S+)\s*$/;
const NPM_GLOBAL_INSTALL_LINE =
  /^\s*(?:run:\s*)?npm\s+(?:install|i)\s+-g\s+(?<packages>.+?)\s*$/;
const PINNED_IMAGE_DIGEST = /@sha256:[a-f0-9]{64}$/;
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

function cleanYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function getNpmPackageVersion(packageSpec: string): string | undefined {
  const versionSeparatorIndex = packageSpec.startsWith("@")
    ? packageSpec.indexOf("@", 1)
    : packageSpec.lastIndexOf("@");

  if (versionSeparatorIndex < 1) {
    return;
  }

  return packageSpec.slice(versionSeparatorIndex + 1);
}

function isPinnedNpmPackage(packageSpec: string): boolean {
  const version = getNpmPackageVersion(packageSpec);
  return Boolean(version && EXACT_NPM_VERSION.test(version));
}

const root = new URL("..", import.meta.url).pathname;
const failures: string[] = [];

for (const file of listWorkflowFiles(join(root, GITHUB_DIR))) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  for (const [index, line] of lines.entries()) {
    const actionMatch = USES_LINE.exec(line);
    const actionTarget = actionMatch?.groups?.target
      ? cleanYamlScalar(actionMatch.groups.target)
      : undefined;

    if (actionTarget && !isLocalAction(actionTarget)) {
      const [, ref] = actionTarget.split("@");
      if (!(ref && PINNED_REF.test(ref))) {
        failures.push(
          `${relative(root, file)}:${index + 1}: action ${actionTarget}`
        );
      }
    }

    const imageMatch = IMAGE_LINE.exec(line);
    const imageTarget = imageMatch?.groups?.target
      ? cleanYamlScalar(imageMatch.groups.target)
      : undefined;

    if (imageTarget && !PINNED_IMAGE_DIGEST.test(imageTarget)) {
      failures.push(
        `${relative(root, file)}:${index + 1}: container image ${imageTarget}`
      );
    }

    const npmGlobalInstallMatch = NPM_GLOBAL_INSTALL_LINE.exec(line);
    const packages = npmGlobalInstallMatch?.groups?.packages
      ?.split(/\s+/)
      .map(cleanYamlScalar)
      .filter((packageSpec) => packageSpec && !packageSpec.startsWith("-"));

    for (const packageSpec of packages ?? []) {
      if (!isPinnedNpmPackage(packageSpec)) {
        failures.push(
          `${relative(root, file)}:${index + 1}: npm global package ${packageSpec}`
        );
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    [
      "GitHub workflow dependencies must be pinned to immutable versions.",
      "",
      ...failures,
      "",
      "Use 40-character commit SHAs for actions, sha256 digests for container images, and exact versions for global npm installs.",
    ].join("\n")
  );
  process.exit(1);
}
